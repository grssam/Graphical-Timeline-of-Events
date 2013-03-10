/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

var EXPORTED_SYMBOLS = ["PageEventsProducer"];

/**
 * The page events producer initializer.
 *
 * @param [object] aWindowList
 *        List of content windows for which PageEventsProducer will listen for
 *        network activity.
 * @param array aEnabledEvents (optional)
 *        List of enabled events type. defaultEvents array will be used if
 *        nothing specified.
 */
function PageEventsProducer(aWindowList, aEnabledEvents, aTimelineUIId, aChromeMode) {
  this.listeningWindows = aWindowList;
  this.enabledEvents = [];
  this.timelineUIId = aTimelineUIId;

  // Bind!
  this.addWindows = this.addWindows.bind(this);
  this.removeWindows = this.removeWindows.bind(this);
  this._addListenersToWindow = this._addListenersToWindow.bind(this);
  this._removeListenersFromWindow = this._removeListenersFromWindow.bind(this);
  this.enableFeatures = this.enableFeatures.bind(this);
  this.disableFeatures = this.disableFeatures.bind(this);
  this.addEventTypes = this.addEventTypes.bind(this);
  this.removeEventTypes = this.removeEventTypes.bind(this);
  this.observe = this.observe.bind(this);
  this.listenEvents = this.listenEvents.bind(this);
  this.onLocationChange = this.onLocationChange.bind(this);
  this.destroy = this.destroy.bind(this);

  if (aEnabledEvents == null || aEnabledEvents.length == 0) {
    aEnabledEvents = this.defaultEvents;
  }

  this.addEventTypes(aEnabledEvents);

  // Listner to reattach the events on location change.
  this.gBrowser = Cc["@mozilla.org/appshell/window-mediator;1"]
                    .getService(Ci.nsIWindowMediator)
                    .getMostRecentWindow("navigator:browser")
                    .gBrowser;
  this.gBrowser.addTabsProgressListener(this);
}

PageEventsProducer.prototype = {
  _sequenceId: 0,

  get sequenceId() "PageEventsProducer-" + (++this._sequenceId),

  get enabledFeatures() this.enabledEvents,

  // Default set which will be neabled if nothing specified in the init call.
  defaultEvents: ["PageEvent"],

  /**
   * Types of events based on DOM event types and some predefined types.
   */
  eventTypes: {
    MouseEvent:    ["click", "mousedown", "mouseup", "mouseover", "mousemove",
                    "mouseout", "mouseenter", "mouseleave", "dblclick",
                    "resize", "DOMMouseScroll", "MozMousePixelScroll"],
    PageEvent:     ["DOMFrameContentLoaded", "DOMWindowClose", "load",
                    "beforeunload", "unload", "DOMContentLoaded",
                    "pageshow", "pagehide", "readystatechange"],
    PaintEvent:    ["MozAfterPaint"],
    KeyboardEvent: ["keydown", "keypress", "keyup"],
    DragEvent:     ["drag", "dragend", "dragenter", "dragleave", "dragover",
                    "dragstart", "drop"],
    //FocusEvent:    ["focus", "blur"],
    //UIEvent:       ["select", "abort", "error"],
    //FormEvent:     ["submit", "reset", "input", "change", "invalid"],
    //MenuEvent:     ["show", "contextmenu"],
    //MiscEvent:     ["mozfullscreenchange", "offline", "online"],
  },

  /**
   * Events observed through system observer.
   */
  observedEvents: {
    PageEvent: ["chrome-document-global-created",
                "content-document-global-created",
                "document-element-inserted",
                "user-interaction-active",
                "user-interaction-inactive"],
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
    for (let window of aWindowList) {
      if (this.listeningWindows.indexOf(window) == -1) {
        this._addListenersToWindow(window);
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
    for (let window of aWindowList) {
      if (this.listeningWindows.indexOf(window) > -1) {
        this._removeListenersFromWindow(window);
        this.listeningWindows.splice(this.listeningWindows.indexOf(window), 1);
      }
    }
  },

  /**
   * Adds the enabled listeners to the window.
   *
   * @param object aContentWindow
   *        The window to which the event should be applied.
   */
  _addListenersToWindow: function PEP__addListenersToWindow(aContentWindow)
  {
    for each (let eventType in this.enabledEvents) {
      if (this.eventTypes[eventType]) {
        for each (let eventName in this.eventTypes[eventType]) {
          aContentWindow.addEventListener(eventName, this.listenEvents, false);
        }
      }
    }
  },

  /**
   * Removes all the enabled listeners fromt he window.
   *
   * @param object aContentWindow
   *        The window from which events are to be removed.
   */
  _removeListenersFromWindow: function PEP__removeListenersFromWindow(aContentWindow)
  {
    for each (let eventType in this.enabledEvents) {
      if (this.eventTypes[eventType]) {
        for each (let eventName in this.eventTypes[eventType]) {
          aContentWindow.removeEventListener(eventName, this.listenEvents, false);
        }
      }
    }
  },

  /**
   * Function used by Data Sink to enable features.
   * @see addEventTypes
   */
  enableFeatures: function PEP_enableFeatures(aFeatures)
  {
    this.addEventTypes(aFeatures);
  },

  /**
   * Function used by Data Sink to disable features.
   * @see addEventTypes
   */
  disableFeatures: function PEP_disableFeatures(aFeatures)
  {
    this.removeEventTypes(aFeatures);
  },

  /**
   * Adds event type sets to listen to.
   *
   * @param array aEventTypes
   *        List of strings containing the type name of the events to start.
   */
  addEventTypes: function PEP_addEventTypes(aEventTypes)
  {
    for (let window of this.listeningWindows) {
      for each (let eventType in aEventTypes) {
        if (this.enabledEvents.indexOf(eventType) == -1) {
          let started = false;
          if (this.eventTypes[eventType]) {
            started = true;
            if (eventType == "PaintEvent") {
              Services.prefs.setBoolPref("dom.send_after_paint_to_content", true);
              for each (let eventName in this.eventTypes[eventType]) {
                window.addEventListener(eventName, this.listenEvents, false);
              }
            }
            else {
              for (let eventName of this.eventTypes[eventType]) {
                window.addEventListener(eventName, this.listenEvents, false);
              }
            }
          }
          if (this.observedEvents[eventType]) {
            started = true;
            for (let eventName of this.observedEvents[eventType]) {
              Services.obs.addObserver(this, eventName, false);
            }
          }
          if (started) {
            this.enabledEvents.push(eventType);
          }
        }
      }
    }
  },

  /**
   * Stops listening to the specified event types.
   *
   * @param array aEventTypes
   *        List of strings containing the type name of the events to stop..
   */
  removeEventTypes: function PEP_removeEventTypes(aEventTypes)
  {
    let stopped = {};
    for (let window of this.listeningWindows) {
      for each (let eventType in aEventTypes) {
        if (this.enabledEvents.indexOf(eventType) != -1) {
          stopped[eventType] = false;
          if (this.eventTypes[eventType]) {
            stopped[eventType] = true;
            try {
              if (eventType == "PaintEvent") {
                Services.prefs.clearUserPref("dom.send_after_paint_to_content");
                for (let eventName of this.eventTypes[eventType]) {
                  window.removeEventListener(eventName, this.listenEvents, false);
                }
              }
              else {
                for (let eventName of this.eventTypes[eventType]) {
                  window.removeEventListener(eventName, this.listenEvents, false);
                }
              }
            }
            catch (ex) {}
          }
          if (this.observedEvents[eventType]) {
            stopped[eventType] = true;
            for (let eventName of this.observedEvents[eventType]) {
              Services.obs.removeObserver(this, eventName, false);
            }
          }
        }
      }
    }
    for each (let eventType in aEventTypes) {
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
  observe: function PEP_observe(aSubject, aTopic, aData)
  {
    if (aTopic == "document-element-inserted") {
      aSubject = aSubject.defaultView;
    }
    if (this.listeningWindows.indexOf(aSubject) == -1) {
      return;
    }

/*      let tabId = null;
     try {
      // Get the chrome window associated with the content window
      let chromeWindow = aSubject.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIWebNavigation)
                                 .QueryInterface(Ci.nsIDocShell)
                                 .chromeEventHandler
                                 .ownerDocument.defaultView;
      // Get the tab indexassociated with the content window
      let tabIndex = chromeWindow.gBrowser
        .getBrowserIndexForDocument(aSubject.document);
      // Get the unique tab id associated with the tab
      tabId = chromeWindow.gBrowser.tabs[tabIndex].linkedPanel;
    } catch (ex) {} */

    let groupId = "";
    for each (let eventTypeName in this.enabledEvents) {
      if (this.observedEvents[eventTypeName] &&
          this.observedEvents[eventTypeName].indexOf(aTopic) >= 0) {
        groupId = eventTypeName;
        break;
      }
    }

    DataSink.addEvent("PageEventsProducer", {
      type: DataSink.NormalizedEventType.POINT_EVENT,
      name: aTopic,
      groupID: groupId,
      time: Date.now(),
      timelineUIId: this.timelineUIId,
      details: {
        observedName: aTopic,
        time: Date.now(),
        /* tabID: tabId, */
      }
    });
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
  listenEvents: function PEP_listenEvents(aEvent)
  {
/*     let tabId = null;
    try {
      let window = null;
      if (aEvent.target instanceof Ci.nsIDOMWindow) {
        window = aEvent.target;
      }
      else if (aEvent.target.defaultView &&
               aEvent.target.defaultView instanceof Ci.nsIDOMWindow) {
        window = aEvent.target.defaultView;
      }
      else if (aEvent.target.ownerDocument &&
               aEvent.target.ownerDocument.defaultView instanceof Ci.nsIDOMWindow) {
        window = aEvent.target.ownerDocument.defaultView;
      }
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
      tabId = chromeWindow.gBrowser.tabs[tabIndex].linkedPanel;
    } catch (ex) {} */

    let eventDetail = {
      target: aEvent.originalTarget.id || null,
      eventName: aEvent.type,
      time: Date.now(),
    };

    let groupId = "";

    for each (let eventTypeName in this.enabledEvents) {
      if (this.eventTypes[eventTypeName].indexOf(aEvent.type) >= 0) {
        groupId = eventTypeName;
        switch (eventTypeName) {
          case "MouseEvent":
            eventDetail.screenX = aEvent.screenX;
            eventDetail.screenY = aEvent.screenY;
            eventDetail.clientX = aEvent.clientX;
            eventDetail.clientY = aEvent.clientY;
            eventDetail.shiftKey = aEvent.shiftKey;
            eventDetail.altKey = aEvent.altKey;
            eventDetail.metaKey = aEvent.metaKey;
            eventDetail.button = aEvent.button;
            break;

          case "KeyboardEvent":
            eventDetail.charCode = String.fromCharCode(aEvent.keyCode?aEvent.keyCode
                                                                     :aEvent.charCode);
            eventDetail.shiftKey = aEvent.shiftKey;
            eventDetail.altKey = aEvent.altKey;
            eventDetail.metaKey = aEvent.metaKey;
            eventDetail.ctrlKey = aEvent.ctrlKey;
            break;

          case "DragEvent":
            eventDetail.data = aEvent.dataTransfer.getData("text/plain");
            break;

          case "PaintEvent":
            eventDetail.rect = aEvent.boundingClientRect;
        }
      }
    }

    DataSink.addEvent("PageEventsProducer", {
      type: DataSink.NormalizedEventType.POINT_EVENT,
      name: aEvent.type,
      groupID: groupId,
      time: Date.now(),
      timelineUIId: this.timelineUIId,
      /* details: {
        tabID: tabId,
        detail: eventDetail,
      } */
      details: eventDetail,
    });
  },

  /**
   * Progress listener to reattach events on page refresh.
   */
  onLocationChange: function PEP_onLocationChange(aBrowser, aWebProgress,
                                                  aRequest, aLocation) {
    let contentWindow = aBrowser.contentWindow;
    if (this.listeningWindows.indexOf(contentWindow) == -1) {
      return;
    }
    this.removeWindows([contentWindow]);
    this.addWindows([contentWindow]);
  },

  /**
   * Stops the Page Events Producer.
   */
  destroy: function PEP_destroy()
  {
    this.removeEventTypes(this.enabledEvents);
    this.gBrowser.removeTabsProgressListener(this);
    this.gBrowser = this.listeningWindows = this.enabledEvents = null;
  },
};

/**
 * The information packet sent to the Data Sink.
 */
let producerInfo = {
  // Id of the producer.
  id: "PageEventsProducer",
  // Name of the producer.
  name: "Page Events",
  // Type of events that this producer listens to (one type per producer).
  type: DataSink.NormalizedEventType.POINT_EVENT,
  // Features of this producer that can be turned on or off.
  // For this producer, its the list of eventsTypes.
  features: ["MouseEvent", "PageEvent", "PaintEvent", "KeyboardEvent",
             "DragEvent", /*"FocusEvent", "UIEvent", "FormEvent",
             "MenuEvent", "MiscEvent"*/],
  // detail view will show properties belonging represented by these names.
  // "propertyName": {name: "display name", type: "boolean", values:{true: "Yes", false: "No"}]
  details: {
    eventName: {name: "Name", type: "string"},
    observedName: {name: "Name", type: "enum", values: {
                    "chrome-document-global-created": "Chrome document created",
                    "content-document-global-created": "Content document created",
                    "document-element-inserted": "Document inserted",
                    "user-interaction-active": "User interaction active",
                    "user-interaction-inactive": "User interaction inactive"
                  }},
    time: {name: "Time", type: "date"},
    target: {name: "Target ID", type: "id"},
    charCode: {name: "Key", type: "string"},
    screenX: {name: "Screen X", type: "px"},
    screenY: {name: "Screen Y", type: "px"},
    clientX: {name: "Client X", type: "px"},
    clientY: {name: "Client Y", type: "px"},
    rect: {name: "Painted Box", type: "rect"},
    shiftKey: {name: "Shift", type: "string"},
    altKey: {name: "Alt", type: "string"},
    metaKey: {name: "Meta", type: "string"},
    ctrlKey: {name: "Control", type: "string"},
    button: {name: "Button", type: "enum", values: {0: "Left Click", 1: "Middle Click", 2: "Right Click"}},
    data: {name: "Data", type: "object"},
  }
};

// Register this producer to Data Sink
DataSink.registerProducer(PageEventsProducer, producerInfo);
