/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

var EXPORTED_SYMBOLS = ["MemoryProducer"];

/**
 * Memory Producer to record CC, GC and memory statistics.
 * Memory statistics not implemented yet.
 */
let MemoryProducer =
{
  _sequence: 0,

  /**
   * Getter for a unique ID for the Memory Producer.
   */
  get sequenceId() "MemoryProducer-" + (++this._sequence),

  /**
   * A getter to be used by DataSink.
   * This getter should list out the list of enabled features ([] if none).
   * The array should contain the ids of the features as provided while
   * registering this producer to the DataSink.
   * @required
   */
  get enabledFeatures() this.enabledEvents,

  // Default set which will be neabled if nothing specified in the init call.
  defaultEvents: ["Cycle Collection", "Garbage Collection"],

  // List of enabled Events.
  enabledEvents: null,

  disablePrefOnUnload: false,

  /**
   * Events observed through system observer.
   */
  observedEvents: {
    "Cycle Collection":   ["cycle-collection-statistics"],
    "Garbage Collection": ["garbage-collection-statistics"],
    //"Memory Statistics":  ["memory-reporter-statistics"],
  },

  /**
   * The network producer initializer.
   *
   * @param [object] aWindowList
   *        Just for consistency with the producer format.
   * @param array aEnabledEvents (optional)
   *        List of enabled events type. defaultEvents array will be used if
   *        nothing specified.
   * @required
   */
  init: function MP_init(aWindowList, aEnabledEvents)
  {
    this.enabledEvents = [];

    if (aEnabledEvents == null || aEnabledEvents.length == 0) {
      aEnabledEvents = this.defaultEvents;
    }

    // set javascript.options.mem.(notify||log) to true to record CC/GC/Resident notifications.
    try {
      if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
        this.disablePrefOnUnload = true;
        Services.prefs.setBoolPref("javascript.options.mem.notify", true);
      }
    } catch (ex) {
      if (!Services.prefs.getBoolPref("javascript.options.mem.log")) {
        this.disablePrefOnUnload = true;
        Services.prefs.setBoolPref("javascript.options.mem.log", true);
      }
    }

    this.enableFeatures(aEnabledEvents);
  },

  /**
   * Adds event type sets to listen to.
   * Function used by Data Sink to enable features.
   *
   * @param array aFeatures
   *        List of strings containing the type name of the events to start.
   * @required
   */
  enableFeatures: function MP_enableFeatures(aFeatures)
  {
    for (let eventType of aFeatures) {
      if (this.enabledEvents.indexOf(eventType) == -1) {
        if (this.observedEvents[eventType]) {
          this.enabledEvents.push(eventType);
          for (let eventName of this.observedEvents[eventType]) {
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
   * @required
   */
  disableFeatures: function MP_disableFeatures(aFeatures)
  {
    let stopped = {};
    for (let eventType of aFeatures) {
      if (this.enabledEvents.indexOf(eventType) != -1) {
        stopped[eventType] = false;
        if (this.observedEvents[eventType]) {
          stopped[eventType] = true;
          for (let eventName of this.observedEvents[eventType]) {
            Services.obs.removeObserver(this.observeEvents, eventName, false);
          }
        }
      }
    }
    for (let eventType of aFeatures) {
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
      let data = JSON.parse(aData);

      // Use milliseconds instead of microseconds for the timestamp
      if ('timestamp' in data) {
        data['timestamp'] = Math.round(data['timestamp'] / 1000);
      }

      let startingTime = data['timestamp'];
      let groupId = MemoryProducer.sequenceId;

      if (aTopic == "cycle-collection-statistics") {
        data['timestamp'] -= (data['duration'] || 0);
        data['name'] = "Cycle Collection";
        // Sending two events, one for start, and one for end of CC
        DataSink.addEvent("MemoryProducer", {
          type: DataSink.NormalizedEventType.REPEATING_EVENT_START,
          name: "Cycle Collection",
          groupID: groupId,
          time: data['timestamp'],
          details: data,
        });
        DataSink.addEvent("MemoryProducer", {
          type: DataSink.NormalizedEventType.REPEATING_EVENT_STOP,
          name: "Cycle Collection",
          groupID: groupId,
          time: data['timestamp'] + (data['duration'] || 0),
          details: data,
        });
      }
      else if (aTopic == "garbage-collection-statistics") {
        // Reconstruct the data to be less of a clutter and more meaningful.
        let slices = data['slices'];
        startingTime -= (slices[slices.length - 1].when + slices[slices.length - 1].pause);
        data = {
          name: "Garbage Collection",
          total_slices: slices.length,
          timestamp: startingTime,
          total_time: data['total_time'],
          compartments_collected: data['compartments_collected'],
          total_compartments: data['total_compartments'],
          mmu_20ms: data['mmu_20ms'],
          mmu_50ms: data['mmu_50ms'],
          max_pause: data['max_pause'],
          nonincremental_reason: data['nonincremental_reason'],
          allocated: data['allocated'],
          added_chunks: data['added_chunks'],
          removed_chunks: data['removed_chunks'],
        };
        for (let i = 0; i < slices.length; i++) {
          data['duration'] = slices[i].pause;
          data['timestamp'] = startingTime + slices[i].when;
          data['slice_no'] = i + 1;
          // Send 2 notification for each slice
          DataSink.addEvent("MemoryProducer", {
            type: DataSink.NormalizedEventType.REPEATING_EVENT_START,
            name: "Garbage Collection",
            groupID: groupId,
            time: JSON.parse(JSON.stringify(data['timestamp'])),
            details: JSON.parse(JSON.stringify(data)),
          });
          DataSink.addEvent("MemoryProducer", {
            type: DataSink.NormalizedEventType.REPEATING_EVENT_STOP,
            name: "Garbage Collection",
            groupID: groupId,
            time: JSON.parse(JSON.stringify(data['timestamp'] + slices[i].pause)),
            details: JSON.parse(JSON.stringify(data)),
          });
        }
      }
    },
  },

  /**
   * Stops the Page Events Producer.
   * @required
   */
  destroy: function MP_destroy()
  {
    try {
      if (this.disablePrefOnUnload && Services.prefs.getBoolPref("javascript.options.mem.notify")) {
        Services.prefs.setBoolPref("javascript.options.mem.notify", false);
      }
    } catch (ex) {
      if (this.disablePrefOnUnload) {
        Services.prefs.setBoolPref("javascript.options.mem.log", false);
      }
    }
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
  name: "Memory Events",
  // Type of events that this producer listens to (one type per producer).
  type: DataSink.NormalizedEventType.REPEATING_EVENT_MID,
  // Features of this producer that can be turned on or off.
  // For this producer, its the list of observedEvents
  features: ["Cycle Collection", "Garbage Collection"/*, "Memory Statistics"*/],
    // detail view will show properties belonging represented by these names.
  // "propertyName": {name: "display name", type: "boolean", values:{true: "Yes", false: "No"}]
  details: {
    name: {name: "Name", type: "string"},
    timestamp: {name: "Time", type: "date"},
    duration: {name: "Duration", type: "ms"},
    slice_no: {name: "Slice Number", type: "number"},
    total_slices: {name: "Total Slices", type: "number"},
    total_time: {name: "Total Time", type: "ms"},
    compartments_collected: {name: "Compartments Collected", type: "number"},
    total_compartments: {name: "Total Compartments", type: "number"},
    mmu_20ms: {name: "20ms MMU", type: "number"},
    mmu_50ms: {name: "50ms MMU", type: "number"},
    max_pause: {name: "Max. Pause", type: "ms"},
    nonincremental_reason: {name: "Non Incremental Reason", type: "string"},
    allocated: {name: "Allocated", type: "string"},
    added_chunks: {name: "Chunks Added", type: "number"},
    removed_chunks: {name: "Chunks Removed", type: "number"},
  }
};

// Register this producer to Data Sink
DataSink.registerProducer(MemoryProducer, producerInfo);
