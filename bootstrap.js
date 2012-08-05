/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
 
"use strict";
let global = this;

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let gAddon;
let reload = function() {};
let timelineWindow = null;
const toolsMenuitemID = "graphical-timeline-tools-menu-item";
const appMenuitemID = "graphical-timeline-app-menu-item";
const keyID = "graphical-timeline-key";
const toolbarButtonID = "developer-toolbar-timelineui";
const commandID = "Tools:TimelineUI";
const broadcasterID = "devtoolsMenuBroadcaster_TimelineUI";

// Function to run on every window which detects customizations
function handleCustomization(window) {
  // Disable the add-on when customizing
  listen(window, window, "beforecustomization", function() {
    if (gAddon.userDisabled)
      return;
    unload();

    // Listen for one customization finish to re-enable the addon
    listen(window, window, "aftercustomization", reload, false);
  });
}

function addMenuItem(window) {
  function $(id) window.document.getElementById(id);

  function toggleTimelineUI() {
    //window.alert("as");
    if (Timeline.UIOpened != true) {
      Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
      DataSink.addRemoteListener(window);
      Timeline.init(function () {
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
      timelineWindow = window.content.window;
    }
    else {
      if (window.content.window != timelineWindow) {
        // Check the checkboxes again.
        $(broadcasterID).setAttribute("checked", "true");
        notificationBox = window.gBrowser.getNotificationBox();
        let buttons = [{
          label: 'Open it in this tab',
          accessKey: 'O',
          callback: reopenTimeline
        },{  
          label: 'Switch to that tab',
          accessKey: 'S',  
          callback: switchToTimelineTab
        }];
        notificationBox.removeAllNotifications(true);
        notificationBox.appendNotification("Timeline is open in another tab (" +
                                            timelineWindow.document.title +
                                            ")" + (window != Timeline._window
                                                   ? " in another window"
                                                   : "") +
                                           ". What would you like to do?",
                                           "", null,
                                           notificationBox.PRIORITY_WARNING_MEDIUM,
                                           buttons,
                                           null);
      }
      else {
        timelineWindow = null;
        Timeline.destroy();
      }
    }
  }

  function reopenTimeline() {
    Timeline.destroy();
    toggleTimelineUI();
  }
  function switchToTimelineTab() {
    Timeline._window.focus();
    Timeline._window.gBrowser.selectedTab = Timeline._window.gBrowser.tabs[
      Timeline._window.gBrowser
              .getBrowserIndexForDocument(timelineWindow.document)
    ];
  }
  function removeMenuItem() {
    let menuitem = $(toolsMenuitemID);
    menuitem && menuitem.parentNode.removeChild(menuitem);
    let appitem = $(appMenuitemID);
    appitem && appitem.parentNode.removeChild(appitem);
    let toolbitem = $(toolbarButtonID);
    toolbitem && toolbitem.parentNode.removeChild(toolbitem);
  }
  function removeKey() {
    let key = $(keyID);
    key && key.parentNode.removeChild(key);
    let command = $(commandID);
    command && command.parentNode.removeChild(command);
  }

  let XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  let notificationBox;
  window.toggleTimelineUI = toggleTimelineUI;
  unload(function() {
    notificationBox = timelineWindow = null;
  }, window);

  let command = window.document.createElement("command");
  command.id = commandID;
  command.setAttribute("oncommand", "toggleTimelineUI()");
  $("mainCommandSet").appendChild(command);

  let broadcaster = window.document.createElement("broadcaster");
  broadcaster.id = broadcasterID;
  broadcaster.setAttribute("label", "Graphical Timeline");
  broadcaster.setAttribute("accesskey", "G");
  broadcaster.setAttribute("type", "checkbox");
  broadcaster.setAttribute("autocheck", "false");
  broadcaster.setAttribute("key", keyID);
  broadcaster.setAttribute("command", commandID);
  $("mainBroadcasterSet").appendChild(broadcaster);

  let menubaritem = window.document.createElement("menuitem");
  menubaritem.id = toolsMenuitemID;
  menubaritem.setAttribute("observes", broadcasterID);
  $("menuWebDeveloperPopup").insertBefore(menubaritem, $("webConsole").nextSibling);

  let appmenuPopup = $("appmenu_webDeveloper_popup");
  if (appmenuPopup) {
    let appmenuitem = window.document.createElement("menuitem");
    appmenuitem.id = appMenuitemID;
    appmenuitem.setAttribute("observes", broadcasterID);
    appmenuPopup.insertBefore(appmenuitem, $("appmenu_webConsole").nextSibling);
  }

  let key = window.document.createElement("key");
  key.id = keyID;
  key.setAttribute("key", "Q");
  key.setAttribute("command", commandID);
  key.setAttribute("modifiers", "accel,shift")
  $("mainKeyset").appendChild(key);

  let button = window.document.createElement("toolbarbutton");
  button.setAttribute("observes", broadcasterID);
  button.setAttribute("label", "Timeline");
  button.classList.add("developer-toolbar-button");
  button.id = toolbarButtonID;
  button.setAttribute("style", "list-style-image: " +
                               "url('chrome://graphical-timeline/content/frontend" +
                               "/images/tools-icons-small.png');" +
                               "-moz-image-region: rect(0, 16px, 16px, 0);");
  $("developer-toolbar").insertBefore(button, $("developer-toolbar-webconsole").nextSibling);

  unload(removeMenuItem, window);
  unload(removeKey, window);
}

function disable(id) {
  AddonManager.getAddonByID(id, function(addon) {
    addon.userDisabled = true;
  });
}

function startup(data, reason) AddonManager.getAddonByID(data.id, function(addon) {
  gAddon = addon;
  // Load various javascript includes for helper functions
  ["helper", "pref"].forEach(function(fileName) {
    let fileURI = addon.getResourceURI("scripts/" + fileName + ".js");
    Services.scriptloader.loadSubScript(fileURI.spec, global);
  });

  function init() {
    Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);
    watchWindows(handleCustomization);
    watchWindows(addMenuItem);
    unload(function() {
      Timeline.destroy();
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
      } catch (e) {}
    });
  }
  reload = function() {
    unload();
    init();
  };
  init();
});

function shutdown(data, reason) {
  if (reason != APP_SHUTDOWN) {
    unload();
  }
}

function install() {}

function uninstall() {}
