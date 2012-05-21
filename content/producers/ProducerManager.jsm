/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["ProducerManager"];

/**
 * The Producer Manager (or maybe Data Sink)
 */
let ProducerManager = {
  _producers: ["NetworkProducer"],
  _enabledProducers: [],

  /**
   * Listen for starting and stopping instructions to enable remote startup
   * and shutdown.
   */
  remoteListener: function PM_remoteListener() {
  },

  sendMessage: function PM_sendMessage() {
  },

  /**
   * Function to explicitly start a producer.
   *
   * @param string aProducer
   *        Name of the producer to start.
   * @param array aFeatures (optional)
   *        List of enabled features. All features will be enabled if null.
   */
  startProducer: function PM_startProducer(aProducer, aFeatures) {
    if (typeof aProducer != "string" ||
        this._enabledProducers.indexOf(aProducer) != -1) {
      // Either aProducer is not a string, or the producer has already started.
      return;
    }
    if (this._producers.indexOf(aProducer) != -1) {
      // try importing the producer and return if file not available.
      try {
        Cu.import("chrome://graphical-timeline/content/producers/" +
          aProducer + ".jsm", this);
      }
      catch (ex) {
        return;
      }
      if (aFeatures == null)
        aFeatures = [];
      this._enabledProducers.push(aProducer);
      this[aProducer].init(this.sendMessage, aFeatures);
    }
  },

  /**
   * Function to explicitly stop a producer.
   *
   * @param string aProducer
   *        Name of the producer to stop.
   */
  stopProducer: function PM_stopProducer(aProducer) {
    if (typeof aProducer != "string" ||
        this._enabledProducers.indexOf(aProducer) == -1) {
      // Either aProducer is not a string, or the producer is already stopped.
      return;
    }
    this[aProducer].destroy();
    this._enabledProducers.slice(this._enabledProducers.indexOf(aProducer), 1);
  },

  /**
   * The manager initialization code. This method should be called to start the
   * producers.
   *
   * @param object aMessage
   *        The object received from the remote graph. If the message is null,
   *        default settings are used and all known producers are started.
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
  init: function PM_init(aMessage) {
    // enable the required producers if aMessage not null.
    if (aMessage) {
      for (let producer in this._producers) {
        if (aMessage.enabledProducers[producer]) {
          // try importing the producer and return if file not available.
          try {
            Cu.import("chrome://graphical-timeline/content/producers/" +
                      producer + ".jsm", this);
          }
          catch (ex) {
            continue;
          }
          this._enabledProducers.push(producer);

          // Initializing the producer with the sendMessage function as first
          // argument. This message will be used by the corresponding producer
          // to send any activity recorded by it.
          this[producer].init(this.sendMessage,
                              aMessage.enabledProducers[producer]);
        }
      }
    }
    // enable all known producers with all features if aMessage null.
    else {
      for (let producer in this._producers) {
        try {
          Cu.import("chrome://graphical-timeline/content/producers/" +
                    producer + ".jsm", this);
        }
        catch (ex) {
          continue;
        }
        this._enabledProducers.push(producer);
        this[producer].init(this.sendMessage);
      }
    }
  },

  /**
   * Stop the running producers and destroy the manager.
   */
  destroy: function PM_destroy() {
    for (let enabledProducer in this._enabledProducers) {
      this[producer].destroy();
    }
    this._enabledProducers = [];
  },
};

// Automatically start listening for messages from remote graph to start the
// producers remotely.
ProducerManager.remoteListener();
