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

function addCommands() {
  Cu.import("resource:///modules/devtools/gcli.jsm");

  /**
   * 'timeline' command.
   */
  gcli.addCommand({
    name: "timeline",
    description: "Control the timeline using the following commands:"
  });

  /**
   * 'timeline toggle' command.
   */
  gcli.addCommand({
    name: "timeline toggle",
    returnType: "html",
    description: "Toggles the Timeline either for the selected tab, or window.",
    params: [{
        group: "Options",
        params: [{
            name: "chrome",
            type: "boolean",
            description: "Toggle the timeline in chrome mode.",
            manual: "In chrome mode, you can view the activities of the whole" +
                    " browser and not just a single tab"
          }]
      }],
    exec: function(aArgs, context) {
      let win = context.environment.chromeDocument.defaultView;
      if (!aArgs.chrome) {
        win.TimelineUI.toggleTimelineUI();
        return;
      }
      if (!Services.prefs.getBoolPref("devtools.chrome.enabled")) {
        let div = win.document.createElement("div");
        div.textContent = "Chrome mode is not enabled";
        return div;
      }
      if (!gDevToolsAvailable) {
        let div = win.document.createElement("div");
        div.textContent = "Your FIrefox does not have DevTools Toolbox Support" +
                          " yet.\nSwitch to Firefox 20 or above to use this options.";
        return div;
      }
      let windowTarget = TargetFactory.forWindow(win);
      win.TimelineUI.toggleTimelineUI(windowTarget, "window");
    }
  });

  /**
   * 'timeline start' command.
   */
  gcli.addCommand({
    name: "timeline start",
    returnType: "html",
    description: "Starts recording the enabled activities in Timeline.",
    manual: "Opens the Timeline if not already open and starts recording" +
            " various activites that are enabled.",
    params: [{
        group: "Options",
        params: [{
            name: "chrome",
            type: "boolean",
            description: "Starts the Timeline in chrome mode.",
          }]
      }],
    exec: function(aArgs, context) {
      let win = context.environment.chromeDocument.defaultView;
      if (gDevToolsAvailable) {
        if (!aArgs.chrome) {
          let target = TargetFactory.forTab(win.gBrowser.selectedTab);
          if (!gDevTools.getToolbox(target) ||
              !gDevTools.getToolbox(target).getPanel("timeline")) {
            win.TimelineUI.toggleTimelineUI().then(function() {
              let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
              timeline.once("AfterUIBuilt", function after() {
                timeline._view.toggleRecording();
              });
            });
          }
          else {
            let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
            if (!timeline._view.recording) {
              timeline._view.toggleRecording();
            }
          }
          return;
        }
        if (!Services.prefs.getBoolPref("devtools.chrome.enabled")) {
          let div = win.document.createElement("div");
          div.textContent = "Chrome mode is not enabled";
          return div;
        }
        if (!gDevToolsAvailable) {
          let div = win.document.createElement("div");
          div.textContent = "Your FIrefox does not have DevTools Toolbox Support" +
                            " yet.\nSwitch to Firefox 20 or above to use this options.";
          return div;
        }
        let target = TargetFactory.forWindow(win);
        if (!gDevTools.getToolbox(target) ||
            !gDevTools.getToolbox(target).getPanel("timeline")) {
          win.TimelineUI.toggleTimelineUI(target, "window").then(function() {
            let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
            timeline.once("AfterUIBuilt", function after() {
              timeline._view.toggleRecording();
            });
          });
        }
        else {
          let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
          if (!timeline._view.recording) {
            timeline._view.toggleRecording();
          }
        }
      }
      else {
        if (TimelineUI.UIOpened) {
          if (!global.Timeline._view.recording) {
            global.Timeline._view.toggleRecording();
          }
        }
        else {
          win.TimelineUI.toggleTimelineUI();
          global.Timeline._view.toggleRecording();
        }
      }
    }
  });

  /**
   * 'timeline stop' command.
   */
  gcli.addCommand({
    name: "timeline stop",
    returnType: "html",
    description: "Stops recording the enabled activities in Timeline.",
    params: [{
        group: "Options",
        params: [{
            name: "chrome",
            type: "boolean",
            description: "Starts the Timeline in chrome mode.",
          }]
      }],
    exec: function(aArgs, context) {
      let win = context.environment.chromeDocument.defaultView;
      if (gDevToolsAvailable) {
        if (!aArgs.chrome) {
          let target = TargetFactory.forTab(win.gBrowser.selectedTab);
          if (gDevTools.getToolbox(target) &&
              gDevTools.getToolbox(target).getPanel("timeline")) {
            let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
            if (timeline._view.recording) {
              timeline._view.toggleRecording();
            }
          }
          return;
        }
        if (!Services.prefs.getBoolPref("devtools.chrome.enabled")) {
          let div = win.document.createElement("div");
          div.textContent = "Chrome mode is not enabled";
          return div;
        }
        if (!gDevToolsAvailable) {
          let div = win.document.createElement("div");
          div.textContent = "Your FIrefox does not have DevTools Toolbox Support" +
                            " yet.\nSwitch to Firefox 20 or above to use this options.";
          return div;
        }
        let target = TargetFactory.forWindow(win);
        if (gDevTools.getToolbox(target) &&
            gDevTools.getToolbox(target).getPanel("timeline")) {
          let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
          if (timeline._view.recording) {
            timeline._view.toggleRecording();
          }
        }
      }
      else {
        if (TimelineUI.UIOpened) {
          if (global.Timeline._view.recording) {
            global.Timeline._view.toggleRecording();
          }
        }
      }
    }
  });
}

function removeCommands() {
  gcli.removeCommand("timeline");
  gcli.removeCommand("timeline toggle");
  gcli.removeCommand("timeline start");
  gcli.removeCommand("timeline stop");
}

let TimelineUI = {

  /**
   * The content window in which timeline is opened.
   * null is Timeline is not opened anywhere.
   */
  window: null,

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
            TimelineUI.window = toolbox._target.window;
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
    addCommands();
  },

  _unload: function TUI__unload()
  {
    if (gDevToolsAvailable) {
      gDevTools.unregisterTool("timeline");
    }
    else {
      global.Timeline.destroy();
    }
    TimelineUI.window = null;
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
    removeCommands();
  },

  _onTabChange: function TUI__onTabChange(window)
  {
    function $(id) window.document.getElementById(id);
    if (global.Timeline && global.Timeline.UIOpened) {
      if (window.gBrowser.selectedTab.linkedBrowser.contentWindow == TimelineUI.window){ 
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
   * @param HostType aHostType [Optional]
   *        The type of host for the toolbox.
   */
  toggleTimelineUI: function TUI_toggleTimelineUI(aTarget, aHostType = null)
  {
    function $(id) window.document.getElementById(id);

    let window = Services.wm.getMostRecentWindow("navigator:browser");
    if (TimelineUI.UIOpened != true) {
      if (gDevToolsAvailable) {
        if (!aTarget) {
          aTarget = TargetFactory.forTab(window.gBrowser.selectedTab);
        }
        TimelineUI.window = aTarget.window;
        return gDevTools.showToolbox(aTarget, "timeline", aHostType);
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
        TimelineUI.window = window.content.window;
      }
    }
    else {
      let contentWindow = window.content.window;
      if (gDevToolsAvailable && aTarget) {
        contentWindow = aTarget.window;
      }
      if (contentWindow != TimelineUI.window) {
        notificationBox = window.gBrowser.getNotificationBox();
        let buttons = [{
          label: 'Open it in this tab',
          accessKey: 'O',
          callback: TimelineUI.reopenTimelineUI.bind(null, aTarget, aHostType)
        },{  
          label: 'Switch to that tab',
          accessKey: 'S',  
          callback: TimelineUI.switchToTimelineTab
        }];
        notificationBox.removeAllNotifications(true);
        notificationBox
          .appendNotification("Timeline is open in another tab (" +
                               TimelineUI.window.document.title +
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
        if (gDevToolsAvailable) {
          return {then: function(){}};
        }
      }
      else {
        TimelineUI.window = null;
        if (!TimelineUI.gDevToolsAvailable) {
          global.Timeline.destroy();
        }
        else {
          if (aTarget) {
            gDevTools.closeToolbox(aTarget);
          }
          else {
            TimelineUI.closeThisToolbox();
          }
          _TimelineUIOpened = false;
        }
      }
    }
  },

  reopenTimelineUI: function TUI_reopenTimelineUI(aTarget, aHostType)
  {
    TimelineUI.closeCurrentlyOpenedToolbox();
    TimelineUI.closeThisToolbox();
    if (!TimelineUI.gDevToolsAvailable) {
      global.Timeline.destroy();
    }
    TimelineUI.toggleTimelineUI(aTarget, aHostType);
  },

  switchToTimelineTab: function TUI_switchToTimelineTab()
  {
    TimelineUI.closeThisToolbox();
    if (!TimelineUI.gDevToolsAvailable) {
      global.Timeline._window.focus();
      global.Timeline._window.gBrowser.selectedTab = TimelineUI.getTimelineTab();
    }
    else {
      let chromeWindow = null;
      try {
        chromeWindow = TimelineUI.window
                                 .QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIWebNavigation)
                                 .QueryInterface(Ci.nsIDocShell)
                                 .chromeEventHandler
                                 .ownerDocument.defaultView;
      } catch(ex) {
        chromeWindow = TimelineUI.window;
      }
      chromeWindow.focus();
      let tab = TimelineUI.getTimelineTab();
      if (tab.linkedPanel) {
        chromeWindow.gBrowser.selectedTab = TimelineUI.getTimelineTab();
      }
    }
  },

  getTimelineTab: function TUI_getTimelineTab()
  {
    if (!TimelineUI.gDevToolsAvailable) {
      return global.Timeline._window.gBrowser.tabs[
        global.Timeline._window.gBrowser.getBrowserIndexForDocument(
          TimelineUI.window.document)];
    }
    else {
      let chromeWindow = null;
      try {
        chromeWindow = TimelineUI.window
                                 .QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIWebNavigation)
                                 .QueryInterface(Ci.nsIDocShell)
                                 .chromeEventHandler
                                 .ownerDocument.defaultView;
      } catch(ex) {
        return {ownerDocument: {defaultView: TimelineUI.window}};
      }
      return chromeWindow.gBrowser.tabs[
        chromeWindow.gBrowser.getBrowserIndexForDocument(
          TimelineUI.window.document)];
    }
  },

  closeCurrentlyOpenedToolbox: function TUI_closeCurrentlyOpenedToolbox()
  {
    if (TimelineUI.gDevToolsAvailable) {
      let tab = TimelineUI.getTimelineTab();
      if (tab.linkedPanel) {
        let target = TargetFactory.forTab(tab);
        gDevTools.closeToolbox(target);
      }
      else {
        let target = TargetFactory.forWindow(TimelineUI.window);
        gDevTools.closeToolbox(target);
      }
      TimelineUI.window = null;
      _TimelineUIOpened = false;
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
