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
    watchWindows(handleCustomization);
    watchWindows(function(window) window.TimelineUI = TimelineUI);
    unload(function() {
      TimelineUI._unload();
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
