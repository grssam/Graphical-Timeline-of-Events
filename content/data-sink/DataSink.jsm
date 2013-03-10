/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

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

/**
 * List of normlaized event types. Any producer should have events falling into
 * one (or more in case of continuous and repeating) of the following events.
 */
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

/**
 * List of known errors that a UI can cause.
 */
const ERRORS = {
  ID_TAKEN: 0, // Id is already used by another timeline UI.
};

function DataSinkActor(aMessage) {
  this.enabledProducers = {};
  this.listeningWindows = [];
  // Assuming that the user does not switch tab between event dispatch and
  // event capturing.
  // If tab id is provided, serach for the correct tab to get the cotent window.
  // Otherwise assume that Timeline is in Chrome mode.
  if (aMessage.tabID && aMessage.tabID.length) {
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements() && aMessage.tabID.length) {
      // Only run the watcher immediately if the window is completely loaded
      let win = windows.getNext();
      if (win.gBrowser.tabs == null)
        continue;
      for (let tab of win.gBrowser.tabs) {
        if (aMessage.tabID.indexOf(tab.linkedPanel) >= 0) {
          let window = tab.linkedBrowser.contentWindow;
          this.listeningWindows.push(window);
          aMessage.tabID.splice(aMessage.tabID.indexOf(tab.linkedPanel), 1);
          if (aMessage.tabID.length == 0) {
            break;
          }
        }
      }
    }
  }
  else {
    this.chromeMode = true;
    let window = Services.wm.getMostRecentWindow("navigator:browser");
    this.listeningWindows.push(window);
  }

  this.id = aMessage.timelineUIId;
  // enable the required producers if aMessage not null.
  if (aMessage.enabledProducers) {
    for (let producer in DataSink.registeredProducers) {
      if (aMessage.enabledProducers[producer]) {
        this.startProducer(producer, aMessage.enabledProducers[producer].features);
      }
    }
  }
  // enable all known producers with all features if aMessage null.
  else {
    for (let producer in DataSink.registeredProducers) {
      this.startProducer(producer, aMessage.enabledProducers[producer].features);
    }
  }

  this.listening = true;
  this.initiated = true;
}

DataSinkActor.prototype = {

  // Represents whether data sink has been started or not.
  initiated: false,

  // Represents whether we are listening or not.
  listening: false,

  chromeMode: false,

  id: "",

  startListening: function DSA_startListening(aMessage) {
    this.enabledProducers = {};
    // enable the required producers if aMessage not null.
    if (aMessage.enabledProducers) {
      for (let producer in DataSink.registeredProducers) {
        if (aMessage.enabledProducers[producer]) {
          this.startProducer(producer, aMessage.enabledProducers[producer].features);
        }
      }
    }
    // enable all known producers with all features if aMessage null.
    else {
      for (let producer in DataSink.registeredProducers) {
        this.startProducer(producer);
      }
    }

    this.listening = true;
    DataSink.sendUpdateNotification(aMessage.timelineUIId);
  },

  stopListening: function DSA_stopListening(aMessage) {
    for (let producer in this.enabledProducers) {
      this.stopProducer(producer);
    }
    this.enabledProducers = null;
    this.listening = false;
  },

  /**
   * Function to start features of a producer.
   *
   */
  enableFeatures: function DSA_enableFeatures(aProducerId, aFeatures) {
    if (this.enabledProducers[aProducerId] != null) {
      if (this.enabledProducers[aProducerId].enableFeatures) {
        this.enabledProducers[aProducerId]
            .enableFeatures(aFeatures);
      }
    }
  },

  /**
   * Function to stop features of a producer.
   *
   */
  disableFeatures: function DSA_disableFeatures(aProducerId, aFeatures) {
    if (this.enabledProducers[aProducerId] != null) {
      if (this.enabledProducers[aProducerId].disableFeatures) {
        this.enabledProducers[aProducerId]
            .disableFeatures(aFeatures);
      }
    }
  },

  /**
   * Function to explicitly start a producer.
   *
   */
  startProducer:
  function DSA_startProducer(aProducerId, aFeatures) {
    if (DataSink.registeredProducers[aProducerId] != null) {
      if (typeof DataSink.registeredProducers[aProducerId] == 'function') {
        this.enabledProducers[aProducerId] =
          new DataSink.registeredProducers[aProducerId]
            (this.listeningWindows, aFeatures, this.id, this.chromeMode);
      }
      else {
        this.enabledProducers[aProducerId] =
          DataSink.registeredProducers[aProducerId];
        this.enabledProducers[aProducerId]
            .init(this.listeningWindows, aFeatures, this.id, this.chromeMode);
      }
    }
  },

  /**
   * Function to explicitly stop a producer.
   *
   */
  stopProducer: function DSA_stopProducer(aProducerId) {
    this.enabledProducers[aProducerId].destroy();
  },

  /**
   * Stop the running producers and destroy the Sink.
   *
   * @param object aMessage
   *        message from the UI containing a property
   *        - timelineUIId (string)
   *          string containing the id of the UI that is being closed.
   *          It might not be the last listening UI, so we will destroy
   *          everything only if its the last.
   */
  destroy: function DSA_destroy(aMessage) {
    if (!this.initiated) {
      return;
    }

    if (this.listening) {
      for (let producer in this.enabledProducers) {
        this.stopProducer(producer);
      }
    }

    this.enabledProducers = null;
    this.listeningWindows = null;
    this.initiated = false;
  },
};

/**
 * The Data Sink
 */
let DataSink = {

  actors: {},

  // Object list holding reference to the producer object.
  registeredProducers: {},

  // Object list containing all the available information on registered producers.
  _producerInfoList: {},
  _sequenceId: 0,

  // Local reference to the const.
  NormalizedEventType: NORMALIZED_EVENT_TYPE,

  get sequenceId() (++this._sequenceId),

  // List of all the Timeline UI that have sent a PING_HELLO to Data Sink.
  registeredUI: {},

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
    // If this timeline UI is not registered, quit.
    if (!this.registeredUI[aMessage.timelineUIId]) {
      return;
    }

    if (this.actors[aMessage.timelineUIId]) {
      return;
    }

    this.actors[aMessage.timelineUIId] = new DataSinkActor(aMessage);
    DataSink.sendUpdateNotification(aMessage.timelineUIId);
  },

  /**
   * Function to start all the producers.
   * If everything is not initiated, then it first does so.
   *
   * @param object aMessage
   *        @see DataSink.init()
   */
  startListening: function DS_startListening(aMessage) {
    // If this timeline UI is not registered, quit.
    if (!this.registeredUI[aMessage.timelineUIId]) {
      return;
    }

    if (!this.actors[aMessage.timelineUIId]) {
      this.init(aMessage);
      return;
    }

    if (this.actors[aMessage.timelineUIId].listening) {
      return;
    }

    this.actors[aMessage.timelineUIId].startListening(aMessage);
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
    // If this timeline UI is not registered, quit.
    if (!this.registeredUI[aMessage.timelineUIId]) {
      return;
    }

    if (!this.actors[aMessage.timelineUIId].listening) {
      return;
    }

    this.actors[aMessage.timelineUIId].stopListening(aMessage);
  },

  /**
   * Registers a remote Timeline UI and sends back a ping reply containing the
   * list of producers available.
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
    let id = aMessage.timelineUIId;
    if (!this.registeredUI[id]) {
      this.registeredUI[id] = 1;
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
   * @param string aId
   *        Id of the remote UI responsible for the update. (Optional)
   *
   * @return aMessage
   *         This message is of the same format that the UI sends to start the
   *         Data Sink.
   *         @see DataSink.init()
   */
  sendUpdateNotification: function DS_sendUpdateNotification(aId) {
    let message = {
      enabledProducers: {},
      timelineUIId: aId,
    };
    for (let producer in this.actors[aId].enabledProducers) {
      let featureList = [];
      if (this.actors[aId].enabledProducers[producer].enabledFeatures) {
        featureList = this.actors[aId].enabledProducers[producer].enabledFeatures;
      }
      message.enabledProducers[producer] = {
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
    if (!message.timelineUIId) {
      return;
    }
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
        if (!DataSink.registeredUI[message.timelineUIId]) {
          return;
        }
        DataSink.enableFeatures(message);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.DISABLE_FEATURES:
        if (!DataSink.registeredUI[message.timelineUIId]) {
          return;
        }
        DataSink.disableFeatures(message);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.START_PRODUCER:
        if (!DataSink.registeredUI[message.timelineUIId]) {
          return;
        }
        DataSink.startProducer(message);
        DataSink.sendUpdateNotification(message.timelineUIId);
        break;

      case UIEventMessageType.STOP_PRODUCER:
        if (!DataSink.registeredUI[message.timelineUIId]) {
          return;
        }
        DataSink.stopProducer(message);
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
      detail: {
        messageData: aMessageData,
        messageType: aMessageType
      }
    };
    if (!this._chromeWindowForGraph) {
      this._chromeWindowForGraph = Services.wm.getMostRecentWindow("navigator:browser");
    }
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
   *        - groupID - same for multiple events associated with the
   *          same continuous process for continuous and repeating events.
   *        - name - a name related with the event to show up on the UI.
   *          recorded the message.
   *        - time - time of the event occurence.
   *        - details (optional) - other details about the event.
   */
  addEvent: function DS_addEvent(aProducerId, aEventData) {
    let normalizedData = aEventData;
    normalizedData.id = DataSink.sequenceId;
    normalizedData.producer = aProducerId;

    DataSink.sendMessage(DataSinkEventMessageType.NEW_DATA, normalizedData);
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
    this.registeredProducers[aProducerInfo.id] = aProducer;
    this._producerInfoList[aProducerInfo.id] = aProducerInfo;
  },

  /**
   * Function to start features of a producer.
   *
   */
  enableFeatures: function DS_enableFeatures(aMessage) {
    if (!this.actors[aMessage.timelineUIId]) {
      return;
    }

    this.actors[aMessage.timelineUIId].enableFeatures(aMessage.producerId, aMessage.features);
  },

  /**
   * Function to stop features of a producer.
   *
   */
  disableFeatures: function DS_disableFeatures(aMessage) {
    if (!this.actors[aMessage.timelineUIId]) {
      return;
    }

    this.actors[aMessage.timelineUIId].disableFeatures(aMessage.producerId, aMessage.features);
  },

  /**
   * Function to explicitly start a producer.
   *
   */
  startProducer:
  function DS_startProducer(aMessage) {
    if (!this.actors[aMessage.timelineUIId]) {
      return;
    }

    this.actors[aMessage.timelineUIId].startProducer(aMessage.producerId, aMessage.features);
  },

  /**
   * Function to explicitly stop a producer.
   *
   * @param string aProducerId
   *        Name of the producer to stop.
   */
  stopProducer: function DS_stopProducer(aMessage) {
    if (!this.actors[aMessage.timelineUIId]) {
      return;
    }

    this.actors[aMessage.timelineUIId].stopProducer(aMessage.producerId);
  },

  /**
   * Stop the running producers and destroy the Sink.
   *
   * @param object aMessage
   *        message from the UI containing a property
   *        - timelineUIId (string)
   *          string containing the id of the UI that is being closed.
   *          It might not be the last listening UI, so we will destroy
   *          everything only if its the last.
   */
  destroy: function DS_destroy(aMessage) {
    if (!this.registeredUI[aMessage.timelineUIId]) {
      return;
    }
    delete this.registeredUI[aMessage.timelineUIId];
    if (this.actors[aMessage.timelineUIId]) {
      this.actors[aMessage.timelineUIId].destroy(aMessage);
      delete this.actors[aMessage.timelineUIId];
    }

    if (JSON.stringify(this.registeredUI).length > 2) {
      return;
    }

    this.registeredUI = {};
  },
};
