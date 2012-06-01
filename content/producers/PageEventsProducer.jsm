/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

var EXPORTED_SYMBOLS = ["PageEventsProducer"];

/**
 */
let PageEventsProducer =
{
  /**
   * List of content windows that this producer is listening to.
   */
  listeningWindows: null,

  _sequence: 0,

  /**
   * Getter for a unique ID for the Page Events Producer.
   */
  get sequenceId() "PageEventsProducer-" + (++this._sequence),

  // Default set which will be neabled if nothing specified in the init call.
  defaultEvents: ["PageEvent"],

  // List of enabled Events.
  enabledEvents: null,

  /**
   * Types of events based on DOM event types and some predefined types.
   */
  eventTypes:
  {
    MouseEvent:    ["click", "mousedown", "mouseup", "mouseover", "mousemove",
                    "mouseout", "mouseenter", "mouseleave", "dblclick",
                    "resize", "DOMMouseScroll", "MozMousePixelScroll"],
    PageEvent:     ["DOMFrameContentLoaded", "MozAfterPaint", "DOMWindowClose",
                    "load", "beforeunload", "unload", "DOMContentLoaded",
                    "pageshow", "pagehide", "readystatechange"],
    KeyboardEvent: ["keydown", "keypress", "keyup"],
    DragEvent:     ["drag", "dragend", "dragenter", "dragleave", "dragover",
                    "dragstart", "drop"],
    FocusEvent:    ["focus", "blur"],
    UIEvent:       ["select", "abort", "error"],
    FormEvent:     ["submit", "reset", "input", "change", "invalid"],
    MenuEvent:     ["show", "contextmenu"],
    MiscEvent:     ["mozfullscreenchange", "offline", "online"],
  },

  /**
   * Events observed through system observer.
   */
  observedEvents:
  {
    PageEvent: ["chrome-document-global-created",
                "content-document-global-created",
                "document-element-inserted",
                "user-interaction-active",
                "user-interaction-inactive"],
  }

  /**
   * The network producer initializer.
   *
   * @param [object] aWindowList
   *        List of content windows for which PageEventsProducer will listen for
   *        network activity.
   * @param array aEnabledEvents (optional)
   *        List of enabled events type. defaultEvents array will be used if
   *        nothing specified.
   */
  init: function PEP_init(aWindowList, aEnabledEvents)
  {
    this.listeningWindows = aWindowList;
    this.enabledEvents = [];

    if (aEnabledEvents == null) {
      aEnabledEvents = this.defaultEvents;
    }

    for each (let window in this.listeningWindows) {
      for each (let eventType in aEnabledEvents) {
        let started = false;
        if (this.eventTypes[eventType]) {
          started = true;
          for each (let eventName in this.eventTypes[eventType]) {
            window.addEventListener(eventName, this.sendActivity, true);
          }
        }
        if (this.observedEvents[eventType]) {
          started = true;
          for each (let eventName in this.eventTypes[eventType]) {
            Services.obs.addObserver(this.observeEvents, eventName, false);
          }
        }
        if (started) {
          this.enabledEvents.push(eventType);
        }
      }
    }
  },

  /**
   * Starts listening to network activity for the given content windows.
   *
   * @param [object] aWindowList
   *        List of content windows for which PageEventsProducer will start
   *        listening for network activity.
   */
  addWindows: function PEP_addWindows(aWindowList)
  {
    for each (let window in aWindowList) {
      if (this.listeningWindows.indexOf(window) == -1) {
        this.addListenersToWindow(window);
        this.listeningWindows.push(window);
      }
    }
  },

  /**
   * Stops listening to network activity for the given windows.
   *
   * @param [object] aWindowList
   *        List of content windows for which PageEventsProducer will stop
   *        listening for network activity.
   */
  removeWindows: function PEP_removeWindows(aWindowList)
  {
    for each (let window in aWindowList) {
      if (this.listeningWindows.indexOf(window) > -1) {
        this.removeListenersFromWindow(window);
        this.listeningWindows.slice(this.listeningWindows.indexOf(window), 1);
      }
    }
  },

  /**
   * nsIObserver for the browser notifications type events.
   */
  observeEvents:
  {
    observe: function PEP_OE_observe(aSubject, aTopic, aData) {
    },
  },

  /**
   * Add a captured event activity object to the data sink to send it to the
   * remote graph.
   * A Normalized Data is sent to the DataSink via the DataSink.addEvent method
   * call.
   *
   * @param object aEvent
   *        The recorded event data.
   */
  sendActivity: function PEP_sendActivity(aHttpActivity)
  {
    let tabId = null;
    let window = aHttpActivity.contentWindow;
    // Get the chrome window associated with the content window
    let chromeWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIWebNavigation)
                             .QueryInterface(Ci.nsIDocShell)
                             .chromeEventHandler
                             .ownerDocument.defaultView;
    // Get the tab indexassociated with the content window
    let tabIndex = chromeWindow.gBrowser
      .getBrowserIndexForDocument(window.document);
    // Get the unique tab id associated with the tab
    try {
      tabId = chromeWindow.gBrowser.tabs[tabIndex].linkedPanel;
    } catch (ex) {}

    let currentStage =
      aHttpActivity.meta.stages[aHttpActivity.meta.stages.length - 1];

    let time;
    try {
      time = aHttpActivity.timings[currentStage].first;
    }
    catch (e) {
      // No time data exist for http-on-examine-response so return.
      return;
    }

    let eventType = null;
    if (currentStage == "REQUEST_HEADER") {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_START;
    }
    else if (currentStage == "TRANSACTION_CLOSE") {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_END;
    }
    else {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_MID;
    }

    DataSink.addEvent("PageEventsProducer", {
      type: eventType,
      name: currentStage,
      groupID: aHttpActivity.id,
      time: time,
      details: {
        tabID: tabId,
        meta: aHttpActivity.meta,
        log: aHttpActivity.log,
      }
    });
  },

  /**
   * Stops the Page Events Producer.
   */
  destroy: function PEP_destroy()
  {
    for each (let window in this.listeningWindows) {
      for each (let eventType in this.enabledEvents) {
        if (this.eventTypes[eventType]) {
          for each (let eventName in this.eventTypes[eventType]) {
            window.removeEventListener(eventName, this.sendActivity, true);
          }
        }
        if (this.observedEvents[eventType]) {
          for each (let eventName in this.eventTypes[eventType]) {
            Services.obs.removeObserver(this.observeEvents, eventName, false);
          }
        }
      }
    }
    this.listeningWindows = this.enabledEvents = null;
  },
};

// Register this producer to Data Sink
DataSink.registerProducer(PageEventsProducer, "PageEventsProducer");
