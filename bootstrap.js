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
const toolsMenuitemID = "graphical-timeline-tools-menu-item";
const appMenuitemID = "graphical-timeline-app-menu-item";
const keyID = "graphical-timeline-key";
const keysetID = "graphical-timeline-keyset";
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

  function removeMenuItem() {
    let menuitem = $(toolsMenuitemID);
    menuitem && menuitem.parentNode.removeChild(menuitem);
    let appitem = $(appMenuitemID);
    appitem && appitem.parentNode.removeChild(appitem);
    let toolbitem = $(toolbarButtonID);
    toolbitem && toolbitem.parentNode.removeChild(toolbitem);
  }
  function removeKey() {
    let keyset = $(keysetID);
    keyset && keyset.parentNode.removeChild(keyset);
    let command = $(commandID);
    command && command.parentNode.removeChild(command);
  }

  let XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  let notificationBox;
  unload(function() {
    notificationBox = timelineWindow = null;
  }, window);

  let command = window.document.createElement("command");
  command.id = commandID;
  window.TimelineUI = TimelineUI;
  command.setAttribute("oncommand", "TimelineUI.toggleTimelineUI()");
  $("mainCommandSet").appendChild(command);

  let broadcaster = window.document.createElement("broadcaster");
  broadcaster.id = broadcasterID;
  broadcaster.setAttribute("label", "Timeline");
  broadcaster.setAttribute("type", "checkbox");
  broadcaster.setAttribute("autocheck", "false");
  broadcaster.setAttribute("key", keyID);
  broadcaster.setAttribute("command", commandID);
  $("mainBroadcasterSet").appendChild(broadcaster);

  let menubaritem = window.document.createElement("menuitem");
  menubaritem.id = toolsMenuitemID;
  menubaritem.setAttribute("observes", broadcasterID);
  menubaritem.setAttribute("accesskey", "I");
  $("menuWebDeveloperPopup").insertBefore(menubaritem, $("webConsole").nextSibling);

  let appmenuPopup = $("appmenu_webDeveloper_popup");
  if (appmenuPopup) {
    let appmenuitem = window.document.createElement("menuitem");
    appmenuitem.id = appMenuitemID;
    appmenuitem.setAttribute("observes", broadcasterID);
    appmenuPopup.insertBefore(appmenuitem, $("appmenu_webConsole").nextSibling);
  }

  let keyset = window.document.createElementNS(XUL, "keyset");
  keyset.id = keysetID;
  let key = window.document.createElementNS(XUL, "key");
  key.id = keyID;
  key.setAttribute("key", "Q");
  key.setAttribute("command", commandID);
  key.setAttribute("modifiers", "accel,shift")
  $("mainKeyset").parentNode.appendChild(keyset).appendChild(key);

  let button = window.document.createElement("toolbarbutton");
  button.setAttribute("observes", broadcasterID);
  button.classList.add("developer-toolbar-button");
  button.id = toolbarButtonID;
  button.setAttribute("style", "list-style-image: " +
                               "url('chrome://graphical-timeline/skin" +
                               "/images/tools-icons-small.png');" +
                               "-moz-image-region: rect(0, 16px, 16px, 0);");
  $("developer-toolbar").insertBefore(button, $("developer-toolbar-webconsole").nextSibling);

  unload(removeMenuItem, window);
  unload(removeKey, window);
  unload(function() {
    delete window.TimelineUI;
  }, window);
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
    Cu.import("chrome://graphical-timeline/content/frontend/TimelineUI.jsm", global);
    TimelineUI._startup();
    watchWindows(function(window) {
      // Tab switch handler.
      listen(window, window.gBrowser.tabContainer, "TabSelect", function() {
        TimelineUI._onTabChange(window);
      }, true);
    });
    watchWindows(handleCustomization);
    if (!TimelineUI.gDevToolsAvailable) {
      watchWindows(addMenuItem);
    }
    else {
      watchWindows(function(window) window.TimelineUI = TimelineUI);
    }
    unload(TimelineUI._unload);
    unload(function() {
      Components.utils.unload("chrome://graphical-timeline/content/frontend/TimelineUI.jsm");
      global.TimelineUI = null;
      delete global.TimelineUI;
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
