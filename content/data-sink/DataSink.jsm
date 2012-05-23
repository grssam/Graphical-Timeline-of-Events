/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");

var EXPORTED_SYMBOLS = ["DataSink"];

/**
 * List of message types that the UI can send.
 */
const UIEventMessageType = {
  INIT_DATA_SINK: 0, // Initialize the Data Sink and start all the producers.
  DESTROY_DATA_SINK: 1, // Destroy the Data Sink and stop all producer activity.
  START_PRODUCER: 2, // To start a single producer.
  STOP_PRODUCER: 3, // To stop a single producer.
  ADD_WINDOW: 4, // Add another window to listen for tab based events.
  REMOVE_WINDOW: 5, // Stop listening for events for tab based events.
};

/**
 * The Data Sink
 */
let DataSink = {
  _registeredProducers: {},
  _enabledProducers: {},

  /**
   * The Data Sink initialization code.
   *
   * @param object aMessage
   *        The object received from the remote graph. If the message is null,
   *        default settings are used and all registered producers are started.
   *        aMessage properties:
   *        - enabledProducers - (required) list of objects representing the
   *        enabled producers. Each object can have property |features|
   *        representing the enabled features of the producer.
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
   *            },
   *          },
   *        }
   */
  init: function DS_init(aMessage) {
    // Assuming that the user does not switch tab between event dispatch and
    // event capturing.
    let contentWindow = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser")
                        .content;
    // enable the required producers if aMessage not null.
    if (aMessage) {
      for (let producer in this._registeredProducers) {
        if (aMessage.enabledProducers[producer]) {
          this.startProducer(contentWindow, producer,
                             aMessage.enabledProducers[producer].features);
        }
      }
    }
    // enable all known producers with all features if aMessage null.
    else {
      for (let producer in this._registeredProducers) {
        this.startProducer(contentWindow, producer);
      }
    }
  },

  /**
   * Listener for events coming from remote Graph UI.
   *
   * @param object aEvent
   *        Data object associated with the incoming event.
   */
  _remoteListener: function DS_remoteListener(aEvent) {
    let message = aEvent.detail.messageData || {};
    let type = aEvent.detail.messageType;
    switch(type) {

      case UIEventMessageType.INIT_DATA_SINK:
        DataSink.init(message);
        break;

      case UIEventMessageType.DESTROY_DATA_SINK:
        DataSink.destroy();
        break;

      case UIEventMessageType.START_PRODUCER:
        let contentWindow = Cc["@mozilla.org/appshell/window-mediator;1"]
                            .getService(Ci.nsIWindowMediator)
                            .getMostRecentWindow("navigator:browser")
                            .content;
        DataSink.startProducer(contentWindow, message.producerName,
                               message.features);
        break;

      case UIEventMessageType.STOP_PRODUCER:
        DataSink.stopProducer(message.producerName);
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
                                   DataSink._remoteListner, true);
  },

  /**
   * Removes the remote event listener from a window.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window from which listener is to be removed.
   */
  removeRemoteListener: function DS_removeRemoteListener(aChromwWindow) {
    aChromeWindow.removeEventListner("GraphicalTimeline:UIEvent",
                                     DataSink._remoteListner, true);
  },

  sendMessage: function DS_sendMessage() {
  },

  /**
   * Each producer calls this method to add a newly captured event/activity.
   * This function converts the data into a normalized form.
   *
   * @param string aEventName
   *        Name of the event in the format ProducerName:EventName.
   * @param object aEventData
   *        List of enabled features. All features will be enabled if null.
   */
  addEvent: function DS_addEvent(aEventName, aEventData) {

  },

  /**
   * Adds a producer to the list of registered producers, which can be later on
   * used to start/stop a producer or to change any of its feature.
   *
   * @param object aProducer
   *        Reference to the producer ot be registered with Data Sink.
   */
  registerProducer: function DS_registerProducer(aProducer, aName) {
    this._registeredProducers[aName] = aProducer;
  },

  /**
   * Function to explicitly start a producer.
   *
   * @param string aProducerName
   *        Name of the producer to start.
   * @param array aFeatures (optional)
   *        List of enabled features. All features will be enabled if null.
   */
  startProducer:
  function DS_startProducer(aContentWindow, aProducerName, aFeatures) {
    if (typeof aProducerName != "string") {
      // aProducerName is not a string.
      return;
    }

    if (this._registeredProducers[aProducerName] != null) {
      if (aFeatures == null)
        aFeatures = [];
      this._enabledProducers[aProducerName] =
        new this._registeredProducers[aProducerName](aContentWindow, aFeatures);
    }
  },

  /**
   * Function to explicitly stop a producer.
   *
   * @param string aProducerName
   *        Name of the producer to stop.
   */
  stopProducer: function DS_stopProducer(aProducerName) {
    if (typeof aProducerName != "string") {
      // aProducerName is not a string.
      return;
    }

    this._enabledProducers[aProducerName].destroy();
  },

  /**
   * Stop the running producers and destroy the Sink.
   */
  destroy: function DS_destroy() {
    for (let producer in this._enabledProducers) {
      this.stopProducer(producer);
    }
    this._listening = this._enabledProducers =
                      this._registeredProducers = null;
  },
};
