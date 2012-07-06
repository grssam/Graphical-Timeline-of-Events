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

  function showHideUI() {
    if (Timeline.UIOpened != true) {
      Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
      DataSink.addRemoteListener(window);
      Timeline.init(function () { // temporary function to be called at destroy
                                  // This is done to avoide memory leak while closing via close button
        global.DataSink.removeRemoteListener(window);
        Cu.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
        global.DataSink = global.MemoryProducer = global.NetworkProducer = global.PageEventsProducer = null;
      }.bind(global));
      $(toolsMenuitemID).setAttribute("checked", true);
      $(appMenuitemID).setAttribute("checked", true);
    }
    else {
      Timeline.destroy();
      $(toolsMenuitemID).removeAttribute("checked");
      $(appMenuitemID).removeAttribute("checked");
    }
  }

  function removeMenuItem() {
    let menuitem = $(toolsMenuitemID);
    menuitem && menuitem.parentNode.removeChild(menuitem);
    let appitem = $(appMenuitemID);
    appitem && appitem.parentNode.removeChild(appitem);
  }
  removeMenuItem();

  let XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  let menuitem = window.document.createElementNS(XUL, "menuitem");
  menuitem.setAttribute("id", appMenuitemID);
  menuitem.setAttribute("type", "checkbox");
  menuitem.setAttribute("label", "Graphical Timeline");
  menuitem.addEventListener("command", showHideUI);
  $("menuWebDeveloperPopup").insertBefore(menuitem, $("webConsole"));

  if (window.navigator.oscpu.search(/^mac/i) != 0) {
    let appMenu = $("appmenu_webDeveloper_popup");
    if (appMenu) {
      let appMenuItem = window.document.createElementNS(XUL, "menuitem");
      appMenuItem.setAttribute("id", appMenuitemID);
      appMenuItem.setAttribute("type", "checkbox");
      appMenuItem.setAttribute("label", "Graphical Timeline");
      appMenuItem.addEventListener("command", showHideUI);
      appMenu.insertBefore(appMenuItem, $("appmenu_webConsole"));
    }
  }
  unload(removeMenuItem, window);
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
        global.DataSink = global.NetworkProducer = global.PageEventsProducer = global.MemoryProducer = null;
      }
      catch (e) {}
      global.Timeline = null;
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
