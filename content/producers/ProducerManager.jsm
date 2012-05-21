/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["ProducerManager"];

/**
 * The Producer Manager (or maybe Dat Sink)
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
      return;
    }
    Cu.import("chrome://graphical-timeline/content/producers/" +
      aProducer + ".jsm", this);
    if (aFeatures == null)
      aFeatures = [];
    this._enabledProducers.push(aProducer);
    this[aProducer].init(this.sendMessage, aFeatures);
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
      return;
    }
    this[aProducer].destroy();
    delete this._enabledProducers[aProducer);
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
    if (aMessage) {
      for (let producer in this._producers) {
        if (aMessage.enabledProducers[producer]) {
          Cu.import("chrome://graphical-timeline/content/producers/" +
                    producer + ".jsm", this);
          this._enabledProducers.push(producer);
          this[producer].init(this.sendMessage,
                              aMessage.enabledProducers[producer]);
        }
      }
    }
    else {
      for (let producer in this._producers) {
        Cu.import("chrome://graphical-timeline/content/producers/" +
                  producer + ".jsm", this);
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
