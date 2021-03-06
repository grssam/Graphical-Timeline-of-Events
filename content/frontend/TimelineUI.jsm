/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

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
      let target = TargetFactory.forWindow(win);
      if (gDevTools.getToolbox(target) &&
          gDevTools.getToolbox(target).getPanel("timeline")) {
        let timeline = gDevTools.getToolbox(target).getPanel("timeline").Timeline;
        if (timeline._view.recording) {
          timeline._view.toggleRecording();
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

  UIOpenedFor: function TUI_UIOpenedFor(aTarget) {
    if (!aTarget) {
      aTarget = TargetFactory.forTab(
        Services.wm.getMostRecentWindow("navigator:browser")
                .gBrowser.selectedTab);
    }
    return gDevTools.getToolbox(aTarget) &&
           !!gDevTools.getToolbox(aTarget).getPanel("timeline");
  },

  _startup: function TUI__startup()
  {
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
        return (new global.TimelinePanel(iframeWindow, toolbox)).open();
      }
    };
    gDevTools.registerTool(timelineDefinition);
    addCommands();
  },

  _unload: function TUI__unload()
  {
    gDevTools.unregisterTool("timeline");
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
    if (TimelineUI.UIOpenedFor(aTarget) != true) {
      if (!aTarget) {
        aTarget = TargetFactory.forTab(window.gBrowser.selectedTab);
      }
      return gDevTools.showToolbox(aTarget, "timeline", aHostType);
    }
    else {
      if (aTarget) {
        gDevTools.closeToolbox(aTarget);
      }
      else {
        TimelineUI.closeThisToolbox();
      }
    }
  },

  closeThisToolbox: function TUI_closeThisToolbox()
  {
    let window = Services.wm.getMostRecentWindow("navigator:browser");
    let target = TargetFactory.forTab(window.gBrowser.selectedTab);
    gDevTools.closeToolbox(target);
  },
};
