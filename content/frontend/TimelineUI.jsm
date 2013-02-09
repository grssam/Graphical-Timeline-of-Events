/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

const broadcasterID = "devtoolsMenuBroadcaster_TimelineUI";
let gDevToolsAvailable, _TimelineUIOpened = false;
var EXPORTED_SYMBOLS = ["TimelineUI"];

try {
  Cu.import("resource:///modules/devtools/gDevTools.jsm");
  Cu.import("resource:///modules/devtools/Target.jsm");
  gDevToolsAvailable = true;
} catch (ex) {
  gDevToolsAvailable = false;
}

let global = {};

let TimelineUI = {

  /**
   * The content window in which timeline is opened.
   * null is Timeline is not opened anywhere.
   */
  contentWindow: null,

  get gDevToolsAvailable() gDevToolsAvailable,

  get UIOpened() {
    if (TimelineUI.gDevToolsAvailable) {
      return _TimelineUIOpened;
    }
    return global.Timeline.UIOpened;
  },

  _startup: function TUI__startup()
  {
    if (gDevToolsAvailable) {
      Cu.import("chrome://graphical-timeline/content/frontend/TimelinePanel.jsm", global);
      let timelineDefinition = {
        id: "timeline",
        key: "Q",
        accesskey: "T",
        modifiers:"accel,shift",
        ordinal: 5,
        killswitch: "devtools.timeline.enabled",
        icon: "chrome://graphical-timeline/skin/images/tool-timeline.png",
        url: "chrome://graphical-timeline/content/frontend/timeline.xul",
        label: "Timeline",
        tooltip: "Graphical Timeline of Events",

        isTargetSupported: function(target) {
          return !target.isRemote;
        },

        build: function(iframeWindow, toolbox) {
          if (TimelineUI.UIOpened == true) {
            TimelineUI.toggleTimelineUI(toolbox._target);
            _TimelineUIOpened = false;
            return {destroy: function() {}, once: function() {}, open: function() {}}.open();
          }
          else {
            TimelineUI.contentWindow = toolbox._target.window;
          }
          _TimelineUIOpened = true;
          return (new global.TimelinePanel(iframeWindow, toolbox, function() {
            _TimelineUIOpened = false;
          })).open();
        }
      };
      gDevTools.registerTool(timelineDefinition);
    }
    else {
      Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);
    }
  },

  _unload: function TUI__unload()
  {
    if (gDevToolsAvailable) {
      gDevTools.unregisterTool("timeline");
    }
    else {
      global.Timeline.destroy();
    }
    TimelineUI.contentWindow = null;
    Components.utils.unload("chrome://graphical-timeline/content/frontend/timeline.jsm");
    try {
      Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
    } catch (e) {}
    try {
      delete global.DataSink;
      delete global.NetworkProducer;
      delete global.PageEventsProducer;
      delete global.MemoryProducer;
      global.Timeline = null;
      delete global.Timeline;
      delete global.TimelinePanel;
    } catch (e) {}
    TimelineUI = null;
  },

  _onTabChange: function TUI__onTabChange(window)
  {
    function $(id) window.document.getElementById(id);
    if (global.Timeline && global.Timeline.UIOpened) {
      if (window.gBrowser.selectedTab.linkedBrowser.contentWindow == TimelineUI.contentWindow){ 
        $(broadcasterID).setAttribute("checked", "true");
      }
      else {
        $(broadcasterID).setAttribute("checked", "false");
      }
    }
  },

  /**
   * Tries to toggle the Timeline UI. Gives a notification if the timelnie is
   * already opened in another tab/window and someone tries to open it.
   *
   * @param Target aTarget [Optional]
   *        The target for Timeline of gDevTools is available.
   */
  toggleTimelineUI: function TUI_toggleTimelineUI(aTarget)
  {
    function $(id) window.document.getElementById(id);

    let window = Services.wm.getMostRecentWindow("navigator:browser");
    if (TimelineUI.UIOpened != true) {
      if (gDevToolsAvailable) {
        if (!aTarget) {
          aTarget = TargetFactory.forTab(window.gBrowser.selectedTab);
        }
        gDevTools.showToolbox(aTarget, "timeline");
        TimelineUI.contentWindow = aTarget.window;
      }
      else {
        Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
        Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
        Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
        Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
        global.DataSink.addRemoteListener(window);
        global.Timeline.init(function () {
          global.DataSink.removeRemoteListener(window);
          try {
            Components.utils.unload("chrome://graphical-timeline/content/frontend/timeline.jsm");
            Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
            Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
            Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
            Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
            delete global.DataSink;
            delete global.NetworkProducer;
            delete global.PageEventsProducer;
            delete global.MemoryProducer;
            global.Timeline = null;
            delete global.Timeline;
            Components.utils.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);
          } catch (e) {}
          try {
            $(broadcasterID).setAttribute("checked", "false");
          } catch (ex) {}
        });
        $(broadcasterID).setAttribute("checked", "true");
        TimelineUI.contentWindow = window.content.window;
      }
    }
    else {
      if (window.content.window != TimelineUI.contentWindow) {
        notificationBox = window.gBrowser.getNotificationBox();
        let buttons = [{
          label: 'Open it in this tab',
          accessKey: 'O',
          callback: TimelineUI.reopenTimelineUI
        },{  
          label: 'Switch to that tab',
          accessKey: 'S',  
          callback: TimelineUI.switchToTimelineTab
        }];
        notificationBox.removeAllNotifications(true);
        notificationBox
          .appendNotification("Timeline is open in another tab (" +
                               TimelineUI.contentWindow.document.title +
                               ")" + (window != TimelineUI.getTimelineTab()
                                                          .ownerDocument
                                                          .defaultView
                                      ? " in another window"
                                      : "") +
                              ". What would you like to do?",
                              "", null,
                              notificationBox.PRIORITY_WARNING_MEDIUM,
                              buttons,
                              null);
      }
      else {
        TimelineUI.contentWindow = null;
        if (!TimelineUI.gDevToolsAvailable) {
          global.Timeline.destroy();
        }
      }
    }
  },

  reopenTimelineUI: function TUI_reopenTimelineUI()
  {
    TimelineUI.closeCurrentlyOpenedToolbox();
    TimelineUI.closeThisToolbox();
    if (!TimelineUI.gDevToolsAvailable) {
      global.Timeline.destroy();
    }
    TimelineUI.toggleTimelineUI();
  },

  switchToTimelineTab: function TUI_switchToTimelineTab()
  {
    TimelineUI.closeThisToolbox();
    if (!TimelineUI.gDevToolsAvailable) {
      global.Timeline._window.focus();
      global.Timeline._window.gBrowser.selectedTab = TimelineUI.getTimelineTab();
    }
    else {
      let chromeWindow = TimelineUI.contentWindow
                                   .QueryInterface(Ci.nsIInterfaceRequestor)
                                   .getInterface(Ci.nsIWebNavigation)
                                   .QueryInterface(Ci.nsIDocShell)
                                   .chromeEventHandler
                                   .ownerDocument.defaultView;
      chromeWindow.focus();
      chromeWindow.gBrowser.selectedTab = TimelineUI.getTimelineTab();
    }
  },

  getTimelineTab: function TUI_getTimelineTab()
  {
    if (!TimelineUI.gDevToolsAvailable) {
      return global.Timeline._window.gBrowser.tabs[
        global.Timeline._window.gBrowser.getBrowserIndexForDocument(
          TimelineUI.contentWindow.document)];
    }
    else {
      let chromeWindow = TimelineUI.contentWindow
                                   .QueryInterface(Ci.nsIInterfaceRequestor)
                                   .getInterface(Ci.nsIWebNavigation)
                                   .QueryInterface(Ci.nsIDocShell)
                                   .chromeEventHandler
                                   .ownerDocument.defaultView;
      return chromeWindow.gBrowser.tabs[
        chromeWindow.gBrowser.getBrowserIndexForDocument(
          TimelineUI.contentWindow.document)];
    }
  },

  closeCurrentlyOpenedToolbox: function TUI_closeCurrentlyOpenedToolbox()
  {
    if (TimelineUI.gDevToolsAvailable) {
      let target = TargetFactory.forTab(TimelineUI.getTimelineTab());
      gDevTools.closeToolbox(target);
    }
  },

  closeThisToolbox: function TUI_closeThisToolbox()
  {
    if (TimelineUI.gDevToolsAvailable) {
      let window = Services.wm.getMostRecentWindow("navigator:browser");
      let target = TargetFactory.forTab(window.gBrowser.selectedTab);
      gDevTools.closeToolbox(target);
    }
  },
};
