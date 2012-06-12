/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["DataSink"];

/**
 * List of message types that the UI can send.
 */
const UIEventMessageType = {
  PING_HELLO: 0, // Tells the remote Data Sink that a UI has been established.
  INIT_DATA_SINK: 1, // Initialize the Data Sink and start all the producers.
  DESTROY_DATA_SINK: 2, // Destroy the Data Sink and stop all producer activity.
  START_RECORDING: 3, // To only start all the producers with given features.
  STOP_RECORDING: 4, // To only stop all the producers with given features.
  START_PRODUCER: 5, // To start a single producer.
  STOP_PRODUCER: 6, // To stop a single producer.
  ENABLE_FEATURES: 7, // To enable features of a producer.
  DISABLE_FEATURES: 8, // To disable features of a producer.
  ADD_WINDOW: 9, // Add another window to listen for tab based events.
  REMOVE_WINDOW: 10, // Stop listening for events for tab based events.
};

/**
 * List of message types that the UI can listen for.
 */
const DataSinkEventMessageType = {
  PING_BACK: 0, // A reply from the remote Data Sink when the UI sends PING_HELLO.
                // Only upon receiving this message, the UI can send a message
                // to start the producers.
  NEW_DATA: 1,  // There is new data in the data store.
  UPDATE_UI: 2, // This event will be sent when there are local changes in
                // active features or producers and those changes need to be
                // reflected back to the UI.
};

const NORMALIZED_EVENT_TYPE = {
  POINT_EVENT: 0, // An instantaneous event like a mouse click.
  CONTINUOUS_EVENT_START: 1, // Start of a process like reloading of a page.
  CONTINUOUS_EVENT_MID: 2, // End of a earlier started process.
  CONTINUOUS_EVENT_END: 3, // End of a earlier started process.
  REPEATING_EVENT_START: 4, // Start of a repeating event like a timer.
  REPEATING_EVENT_MID: 5, // An entity of a repeating event which is neither
                          // start nor end.
  REPEATING_EVENT_STOP: 6, // End of a repeating event.
};

const ERRORS = {
  ID_TAKEN: 0, // Id is already used by another timeline UI.
};

/**
 * The Data Sink
 */
let DataSink = {
  // List of content windows that this Data Sink is active on.
  listeningWindows: [],
  // Object list holding reference to the producer object.
  _registeredProducers: {},
  // Object list holding reference to the enabled producr instance.
  _enabledProducers: null,
  // Object list containing all the available information on registered producers.
  _producerInfoList: {},
  _sequenceId: 0,

  NormalizedEventType: NORMALIZED_EVENT_TYPE,

  get sequenceId() (++this._sequenceId),

  get _chromeWindowForGraph() Cc["@mozilla.org/appshell/window-mediator;1"]
                                .getService(Ci.nsIWindowMediator)
                                .getMostRecentWindow("navigator:browser"),

  // List of all the Timeline UI that have sent a PING_HELLO to Data Sink.
  registeredUI: [],

  // The database name for the current session of data sink.
  databaseName: "",

  // Represents whether data sink has been started or not.
  initiated: false,

  // Represents whether we are listening or not.
  listening: false,

  /**
   * The Data Sink initialization code.
   *
   * @param object aMessage
   *        The object received from the remote graph.
   *        - enabledProducers - (optional) list of objects representing the
   *        enabled producers. Each object can have property |features|
   *        representing the enabled features of the producer.
   *        If null, all producers will be started.
   *        - timelineUIId - (required) This is a unique id represnting a
   *        timeline UI.
   *
   *        Example message:
   *        {
   *          enabledProducers:
   *          {
   *            NetworkMonitor:
   *            {
   *              // List of enabled features (Optional)
   *              features: ["logging", "header"],
   *            },
   *            PageEventProducer:
   *            {
   *              features: ["LoadEvent", "MouseEvent"],
   *            },
   *          },
   *          timelineUIId: "timeline-ui-12483",
   *        }
   */
  init: function DS_init(aMessage) {
    // Do not start the producers again.
    if (this.initiated) {
      // Send the update message without any id so that all UI update.
      this.sendUpdateNotification("");
      return;
    }

    // Stop if aMessage is null (as we need the timelineUIId).
    if (!aMessage || !aMessage.timelineUIId) {
      return;
    }

    // If this timeline UI is not registered, quit.
    if (!this.registeredUI || this.registeredUI.indexOf(aMessage.timelineUIId) == -1) {
      return;
    }

    this._enabledProducers = {};
    // Assuming that the user does not switch tab between event dispatch and
    // event capturing.
    let contentWindow = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser")
                        .content;
    this.listeningWindows = [contentWindow];
    // enable the required producers if aMessage not null.
    if (aMessage.enabledProducers) {
      for (let producer in this._registeredProducers) {
        if (aMessage.enabledProducers[producer]) {
          this.startProducer(producer, aMessage.enabledProducers[producer].features);
        }
      }
    }
    // enable all known producers with all features if aMessage null.
    else {
      for (let producer in this._registeredProducers) {
        this.startProducer(producer);
      }
    }

    this.listening = true;

    this._chromeWindowForGraph =
      contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                   .getInterface(Ci.nsIWebNavigation)
                   .QueryInterface(Ci.nsIDocShell)
                   .chromeEventHandler
                   .ownerDocument.defaultView;

    // Initiating the Data Store
    Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
    this.dataStore = new DataStore(this.databaseName);
    Services.prompt.confirm(null, "", "DataSink: Message to start received");
    this.initiated = true;
    this.sendUpdateNotification("");
  },

  /**
   * Function to start all the producers.
   * If everything is not initiated, then it first does so.
   *
   * @param object aMessage
   *        @see DataSink.init()
   */
  startListening: function DS_startListening(aMessage) {
    // Do not start the producers if everything is not initiated or we are
    // already listening.
    if (!this.initiated) {
      this.init(aMessage);
      return;
    }

    if (this.listening) {
      return;
    }

    // Stop if aMessage is null (as we need the timelineUIId).
    if (!aMessage || !aMessage.timelineUIId) {
      return;
    }

    // If this timeline UI is not registered, quit.
    if (!this.registeredUI || this.registeredUI.indexOf(aMessage.timelineUIId) == -1) {
      return;
    }

    this._enabledProducers = {};
    // enable the required producers if aMessage not null.
    if (aMessage.enabledProducers) {
      for (let producer in this._registeredProducers) {
        if (aMessage.enabledProducers[producer]) {
          this.startProducer(producer, aMessage.enabledProducers[producer].features);
        }
      }
    }
    // enable all known producers with all features if aMessage null.
    else {
      for (let producer in this._registeredProducers) {
        this.startProducer(producer);
      }
    }
Services.prompt.confirm(null, "", "3");
    this.listening = true;
    this.sendUpdateNotification(aMessage.timelineUIId);
  },

  /**
   * Stop the running producers.
   *
   * @param object aMessage
   *        message from the UI containing a property
   *        - timelineUIId (string)
   *          string containing the id of the UI that ordeered this stop.
   */
  stopListening: function DS_stopListening(aMessage) {
    if (this.registeredUI.indexOf(aMessage.timelineUIId) == -1) {
      return;
    }

    if (this.listening) {
      for (let producer in this._enabledProducers) {
        this.stopProducer(producer);
      }
      this._enabledProducers = null;
      this.listening = false;
      Services.prompt.confirm(null, "", "Stop");
    }
  },

  /**
   * Registers a remote Timeline UI and sends back a ping reply containing the
   * name of the IndexedDB database.
   *
   * @param object aMessage
   *        This contains the property timelineUIId representing the id to be
   *        registered.
   *
   *        Example message:
   *        {
   *          timelineUIId: "timeline-ui-12483",
   *        }
   */
  replyToPing: function DS_replyToPing(aMessage) {
    if (!aMessage || !aMessage.timelineUIId) {
      return;
    }
    if (!this.registeredUI) {
      this.registeredUI = [];
    }

    let id = aMessage.timelineUIId;
    if (this.registeredUI.indexOf(id) == -1) {
      this.registeredUI.push(id);
      if (this.databaseName == "") {
        this.databaseName = "timeline-database-" + (new Date()).getTime();
      }
      aMessage.databaseName = this.databaseName;
      aMessage.producerInfoList = this._producerInfoList;
    }
    else {
      aMessage.error = ERRORS.ID_TAKEN;
    }

    this.sendMessage(DataSinkEventMessageType.PING_BACK, aMessage);
  },

  /**
   * Sends an updated list of active producers and features to all the remote UI
   * instances so that they can update the UI accordingly. Also sends the Id of
   * the remote UI responsible for the update.
   *
   * @param string Id
   *        Id of the remote UI responsible for the update. (Optional)
   *
   * @return aMessage
   *         This message is of the same format that the UI sends to start the
   *         Data Sink.
   *         @see DataSink.init()
   */
  sendUpdateNotification: function DS_sendUpdateNotification(Id)
  {
    let message =
    {
      enabledProducers: {},
      timelineUIId: Id,
    };
    for (let producer in this._enabledProducers) {
      let featureList = [];
      if (this._enabledProducers[producer].enabledFeatures) {
        featureList = this._enabledProducers[producer].enabledFeatures;
      }
      message.enabledProducers[producer] =
      {
        features: featureList,
      };
    }
    this.sendMessage(DataSinkEventMessageType.UPDATE_UI, message);
  },

  /**
   * Listener for events coming from remote Graph UI.
   *
   * @param object aEvent
   *        Data object associated with the incoming event.
   */
  _remoteListener: function DS_remoteListener(aEvent) {
    let message = aEvent.detail.messageData;
    let type = aEvent.detail.messageType;
    switch(type) {

      case UIEventMessageType.PING_HELLO:
        DataSink.replyToPing(message);
        break;

      case UIEventMessageType.INIT_DATA_SINK:
        DataSink.init(message);
        break;

      case UIEventMessageType.DESTROY_DATA_SINK:
        DataSink.destroy(message);
        break;

      case UIEventMessageType.ENABLE_FEATURES:
        if (!message.timelineUIId ||
            DataSink.registeredUI.indexOf(message.timelineUIId) == -1) {
          return;
        }
        DataSink.enableFeatures(message.producerId, message.features);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.DISABLE_FEATURES:
        if (!message.timelineUIId ||
            DataSink.registeredUI.indexOf(message.timelineUIId) == -1) {
          return;
        }
        DataSink.disableFeatures(message.producerId, message.features);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.START_PRODUCER:
        if (!message.timelineUIId ||
            DataSink.registeredUI.indexOf(message.timelineUIId) == -1) {
          return;
        }
        DataSink.startProducer(message.producerId, message.features);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.STOP_PRODUCER:
        if (!message.timelineUIId ||
            DataSink.registeredUI.indexOf(message.timelineUIId) == -1) {
          return;
        }
        DataSink.stopProducer(message.producerId);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.START_RECORDING:
        DataSink.startListening(message);
        break;

      case UIEventMessageType.STOP_RECORDING:
        DataSink.stopListening(message);
        break;
    }
  },

  /**
   * Listen for starting and stopping instructions to enable remote startup
   * and shutdown.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window to apply the event listener.
   */
  addRemoteListener: function DS_addRemoteListener(aChromeWindow) {
    aChromeWindow.addEventListener("GraphicalTimeline:UIEvent",
                                   DataSink._remoteListener, true);
  },

  /**
   * Removes the remote event listener from a window.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window from which listener is to be removed.
   */
  removeRemoteListener: function DS_removeRemoteListener(aChromeWindow) {
    aChromeWindow.removeEventListener("GraphicalTimeline:UIEvent",
                                     DataSink._remoteListener, true);
  },

  /**
   * Fires an event to let the Graph UI know about data changes.
   *
   * @param int aMessageType
   *        One of DataSinkEventMessageType
   * @param object aMessageData
   *        Data concerned with the event.
   */
  sendMessage: function DS_sendMessage(aMessageType, aMessageData) {
    let detail = {
                   "detail":
                     {
                       "messageData": aMessageData,
                       "messageType": aMessageType,
                     },
                 };
    let customEvent =
      new this._chromeWindowForGraph
              .CustomEvent("GraphicalTimeline:DataSinkEvent", detail);
    this._chromeWindowForGraph.dispatchEvent(customEvent);
  },

  /**
   * Each producer calls this method to add a newly captured event/activity.
   * This function converts the data into a normalized form.
   *
   * @param string aProducerId
   *        Id of the producer from which the event is coming.
   *        Example: NetworkProducer
   * @param object aEventData
   *        The event object. Contain the following properties:
   *        - type - one of the NORMALIZED_EVENT_TYPE
   *        - groupID (optional) - same for multiple events associated with the
   *          same continuous process for continuous and repeating events.
   *        - name - a name related with the event to show up on the UI.
   *          recorded the message.
   *        - time - time of the event occurence.
   *        - details (optional) - other details about the event.
   */
  addEvent: function DS_addEvent(aProducerId, aEventData) {
    if (!this._enabledProducers[aProducerId]) {
      return;
    }

    let normalizedData = aEventData;
    normalizedData.id = this.sequenceId;
    normalizedData.producer = aProducerId;

    // Adding the normalized data to the data store object.
    if (this.dataStore.add(normalizedData)) {
      // Informing the Graph UI about the new data.
      DataSink.sendMessage(DataSinkEventMessageType.NEW_DATA);
    }
  },

  /**
   * Adds a producer to the list of registered producers, which can be later on
   * used to start/stop a producer or to change any of its feature.
   *
   * @param object aProducer
   *        Reference to the producer ot be registered with Data Sink.
   * @param object aProducerInfo
   */
  registerProducer: function DS_registerProducer(aProducer, aProducerInfo) {
    this._registeredProducers[aProducerInfo.id] = aProducer;
    this._producerInfoList[aProducerInfo.id] = aProducerInfo;
  },

  /**
   * Function to start features of a producer.
   *
   * @param string aProducerId
   *        Id of the producer whose features will be enabled.
   * @param array aFeatures
   *        List of features to enable.
   */
  enableFeatures: function DS_enableFeatures(aProducerId, aFeatures) {
    if (typeof aProducerId != "string") {
      // aProducerId is not a string.
      return;
    }

    if (this._enabledProducers[aProducerId] != null) {
      if (this._enabledProducers[aProducerId].enableFeatures) {
        this._enabledProducers[aProducerId].enableFeatures(aFeatures);
      }
    }
  },

  /**
   * Function to stop features of a producer.
   *
   * @param string aProducerId
   *        Id of the producer whose features will be disabled.
   * @param array aFeatures
   *        List of features to disable.
   */
  disableFeatures: function DS_disableFeatures(aProducerId, aFeatures) {
    if (typeof aProducerId != "string") {
      // aProducerId is not a string.
      return;
    }

    if (this._enabledProducers[aProducerId] != null) {
      if (this._enabledProducers[aProducerId].disableFeatures) {
        this._enabledProducers[aProducerId].disableFeatures(aFeatures);
      }
    }
  },

  /**
   * Function to explicitly start a producer.
   *
   * @param string aProducerId
   *        Id of the producer to start.
   * @param array aFeatures (optional)
   *        List of enabled features. All features will be enabled if null.
   */
  startProducer:
  function DS_startProducer(aProducerId, aFeatures) {
    if (typeof aProducerId != "string") {
      // aProducerId is not a string.
      return;
    }

    if (this._registeredProducers[aProducerId] != null) {
      if (typeof this._registeredProducers[aProducerId] == 'function') {
        this._enabledProducers[aProducerId] =
          new this._registeredProducers[aProducerId](this.listeningWindows,
                                                     aFeatures);
      }
      else {
        this._enabledProducers[aProducerId] = this._registeredProducers[aProducerId];
        this._enabledProducers[aProducerId].init(this.listeningWindows, aFeatures);
      }
    }
  },

  /**
   * Function to explicitly stop a producer.
   *
   * @param string aProducerId
   *        Name of the producer to stop.
   */
  stopProducer: function DS_stopProducer(aProducerId) {
    if (typeof aProducerId != "string") {
      // aProducerId is not a string.
      return;
    }

    this._enabledProducers[aProducerId].destroy();
  },

  /**
   * Stop the running producers and destroy the Sink.
   *
   * @param object aMessage
   *        message from the UI containing a property
   *        - deleteDatabase (boolean)
   *          true if you want to delete the database when closing.
   *        - timelineUIId (string)
   *          string containing the id of the UI that is being closed.
   *          It might not be the last listening UI, so we will destroy
   *          everything only if its the last.
   */
  destroy: function DS_destroy(aMessage) {
    if (!this.initiated) {
      return;
    }
    if (this.registeredUI.indexOf(aMessage.timelineUIId) == -1) {
      return;
    }
    this.registeredUI.splice(this.registeredUI.indexOf(aMessage.timelineUIId), 1);

    if (this.registeredUI.length > 0) {
      return;
    }

    if (this.listening) {
      for (let producer in this._enabledProducers) {
        this.stopProducer(producer);
      }
    }
    this.dataStore.destroy(aMessage.deleteDatabase);
    try {
      Cu.unload("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
    } catch (ex) {}
    DataStore = this.registeredUI = this.dataStore = 
      this._enabledProducers = this.listeningWindows = null;
    this.initiated = false;
    this.databaseName = "";
    Services.prompt.confirm(null, "", "Stopped all the producers");
  },
};
