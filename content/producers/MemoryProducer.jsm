/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

var EXPORTED_SYMBOLS = ["MemoryProducer"];

/**
 */
let MemoryProducer =
{

  get enabledFeatures() this.enabledEvents,

  // Default set which will be neabled if nothing specified in the init call.
  defaultEvents: ["Cycle Collection", "Garbage Collection"],

  // List of enabled Events.
  enabledEvents: null,

  /**
   * Events observed through system observer.
   */
  observedEvents: {
    "Cycle Collection":   ["cycle-collection-statistics"],
    "Garbage Collection": ["garbage-collection-statistics"],
    "Memory Statistics":  ["memory-reporter-statistics"],
  },

  /**
   * The network producer initializer.
   *
   * @param [object] aWindowList
   *        Just for consistency with the producer format.
   * @param array aEnabledEvents (optional)
   *        List of enabled events type. defaultEvents array will be used if
   *        nothing specified.
   */
  init: function MP_init(aWindowList, aEnabledEvents)
  {
    this.enabledEvents = [];

    if (aEnabledEvents == null || aEnabledEvents.length == 0) {
      aEnabledEvents = this.defaultEvents;
    }

    this.enableFeatures(aEnabledEvents);
  },

  /**
   * Adds event type sets to listen to.
   * Function used by Data Sink to enable features.
   *
   * @param array aFeatures
   *        List of strings containing the type name of the events to start.
   */
  enableFeatures: function MP_enableFeatures(aFeatures)
  {
    for each (let eventType in aFeatures) {
      if (this.enabledEvents.indexOf(eventType) == -1) {
        if (this.observedEvents[eventType]) {
          this.enabledEvents.push(eventType);
          for each (let eventName in this.observedEvents[eventType]) {
            Services.obs.addObserver(this.observeEvents, eventName, false);
          }
        }
      }
    }
  },

  /**
   * Stops listening to the specified event types.
   * Function used by Data Sink to disable features.
   *
   * @param array aFeatures
   *        List of strings containing the type name of the events to stop.
   */
  disableFeatures: function MP_disableFeatures(aFeatures)
  {
    let stopped = {};
    for each (let eventType in aFeatures) {
      if (this.enabledEvents.indexOf(eventType) != -1) {
        stopped[eventType] = false;
        if (this.observedEvents[eventType]) {
          stopped[eventType] = true;
          for each (let eventName in this.observedEvents[eventType]) {
            Services.obs.removeObserver(this.observeEvents, eventName, false);
          }
        }
      }
    }
    for each (let eventType in aFeatures) {
      if (this.enabledEvents.indexOf(eventType) != -1 && stopped[eventType]) {
        this.enabledEvents.splice(this.enabledEvents.indexOf(eventType), 1)
      }
    }
  },

  /**
   * nsIObserver for the browser notifications type events.
   *
   * A Normalized Data is sent to the DataSink via the DataSink.addEvent method
   * call.
   */
  observeEvents: {
    observe: function MP_OE_observe(aSubject, aTopic, aData)
    {
      let groupId = "";
      for each (let eventTypeName in MemoryProducer.enabledEvents) {
        if (MemoryProducer.observedEvents[eventTypeName] && 
            MemoryProducer.observedEvents[eventTypeName].indexOf(aTopic) >= 0) {
          groupId = eventTypeName;
          break;
        }
      }

      let data = JSON.parse(aData);
 
      // Use milliseconds instead of microseconds for the timestamp
      if ('timestamp' in data) {
        data['timestamp'] = Math.round(data['timestamp'] / 1000);
      }

      DataSink.addEvent("MemoryProducer", {
        type: DataSink.NormalizedEventType.POINT_EVENT,
        name: aTopic,
        groupID: groupId,
        time: data['timestamp'],
        details: {
          data: data,
        }
      });
    },
  },

  /**
   * Stops the Page Events Producer.
   */
  destroy: function MP_destroy()
  {
    this.disableFeatures(this.enabledEvents);
    this.enabledEvents = null;
  },
};

/**
 * The information packet sent to the Data Sink.
 */
let producerInfo = {
  // Id of the producer.
  id: "MemoryProducer",
  // Name of the producer.
  name: "Memory Producer",
  // Type of events that this producer listens to (one type per producer).
  type: DataSink.NormalizedEventType.POINT_EVENT,
  // Features of this producer that can be turned on or off.
  // For this producer, its the list of observedEvents
  features: ["Cycle Collection", "Garbage Collection", "Memory Statistics"],
};

// Register this producer to Data Sink
DataSink.registerProducer(MemoryProducer, producerInfo);
