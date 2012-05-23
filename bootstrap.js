/* ***** BEGIN LICENSE BLOCK *****
 * Version: MIT/X11 License
 * 
 * Copyright (c) 2011 Girish Sharma
 * 
 * Permission is hereby granted, free of charge, to any person obtaining copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Contributor:
 *   Girish Sharma <scrapmachines@gmail.com> (Creator)
 *
 * ***** END LICENSE BLOCK ***** */
 
"use strict";
let global = this;

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
Cu.import("chrome://graphical-timeline/content/graph/GraphUI.jsm");

let gAddon;
let reload = function() {};
let toolbarButtonID = "graphical-timeline-toolbar-button";
const LOGO = "";

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

function addToolbarButton(window) {
  function $(id) window.document.getElementById(id);

  function saveToolbarButtonInfo(event) {
    if ($(toolbarButtonID) && toolbarButton.parentNode) {
      pref("buttonParentID", toolbarButton.parentNode.getAttribute("id") || "");
      pref("buttonNextSiblingID", (toolbarButton.nextSibling || "")
        && toolbarButton.nextSibling.getAttribute("id").replace(/^wrapper-/i, ""));
    }
    else
      pref("buttonParentID", "");
  }

  // add toolbar button.
  toolbarButton = window.document.createElementNS(XUL, "toolbarbutton");
  toolbarButton.setAttribute("id", toolbarButtonID);
  toolbarButton.setAttribute("class", "chromeclass-toolbar-additional toolbarbutton-1");
  toolbarButton.setAttribute("type", "button");
  toolbarButton.setAttribute("image", LOGO);
  toolbarButton.setAttribute("label", toolbarButtonLabel);
  toolbarButton.setAttribute("tooltiptext", l10n("USM.tooltip"));
  toolbarButton.setAttribute("orient", "horizontal");
  toolbarButton.addEventListener("command", GraphUI.showGraphUI);

  $("navigator-toolbox").palette.appendChild(toolbarButton);
  let buttonParentID = pref("buttonParentID");
  if (buttonParentID.length > 0) {
    let parent = $(buttonParentID);
    if (parent) {
      let nextSiblingID = pref("buttonNextSiblingID");
      let nextSibling = $(nextSiblingID);
      if (!nextSibling) {
        let currentset = parent.getAttribute("currentset").split(",");
        let i = currentset.indexOf(toolbarButtonID) + 1;
        if (i > 0) {
          let len = currentset.length;
          for (; i < len; i++) {
            nextSibling = $(currentset[i]);
            if (nextSibling)
              break;
          }
        }
      }
      parent.insertItem(toolbarButtonID, nextSibling, null, false);
    }
  }
  let unloadButton = function() {
    window.removeEventListener("aftercustomization", saveToolbarButtonInfo);
    try {
      toolbarButton.removeEventListener("command", showGraphUI);
      toolbarButton.parentNode.removeChild(toolbarButton);
    } catch(ex) {}
  };
  window.addEventListener("aftercustomization", saveToolbarButtonInfo, false);
  unload2(unloadButton);
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
    watchWindows(handleCustomization);
    watchWindows2(addToolbarButton);
    watchWindows(function(window) {
      DataSink.addRemoteListener(window);
      unload(function() {
        DataSink.removeRemoteListener(window);
      }, window);
    });
    GraphUI.hideGraphUI();
  }
  reload = function() {
    unload();
    init();
  };
  init();
});

function shutdown(data, reason) {
  if (reason != APP_SHUTDOWN)
    unload();
}

function install() {}

function uninstall() {}
