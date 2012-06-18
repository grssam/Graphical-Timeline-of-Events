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

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let gAddon;
let reload = function() {};
let toolbarButtonID = "graphical-timeline-toolbar-button";
let toolbarButton = null;
const LOGO = "data:image/png;base64,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";

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

  function showHideUI() {
    if (GraphUI.UIOpened != true) {
      Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
      Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
      DataSink.addRemoteListener(window);
      GraphUI.init(function () { // temporary function to be called at destroy
                                 // This is done to avoide memory leak while closing via close button
        global.DataSink.removeRemoteListener(window);
        Cu.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
        Cu.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
        global.DataSink = global.MemoryProducer = global.NetworkProducer = global.PageEventsProducer = null;
      }.bind(global));
    }
    else {
      GraphUI.destroy();
    }
  }

  // add toolbar button.
  toolbarButton = window.document.createElement("toolbarbutton");
  toolbarButton.setAttribute("id", toolbarButtonID);
  toolbarButton.setAttribute("class", "toolbarbutton-1");
  toolbarButton.setAttribute("image", LOGO);
  toolbarButton.setAttribute("label", "UI");
  toolbarButton.setAttribute("tooltiptext", "Click to open the UI");
  toolbarButton.setAttribute("orient", "horizontal");
  toolbarButton.addEventListener("command", showHideUI);

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
      toolbarButton.removeEventListener("command", showHideUI);
      toolbarButton.parentNode.removeChild(toolbarButton);
    } catch(ex) {}
  };

  window.addEventListener("aftercustomization", saveToolbarButtonInfo, false);
  unload2(unloadButton, window);
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
    Cu.import("chrome://graphical-timeline/content/graph/GraphUI.jsm", global);
    watchWindows(handleCustomization);
    unload(function() {
      GraphUI.destroy();
      Components.utils.unload("chrome://graphical-timeline/content/graph/GraphUI.jsm");
      try {
        Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
        Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
        Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
        Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
        global.DataSink = global.NetworkProducer = global.PageEventsProducer = global.MemoryProducer = null;
      }
      catch (e) {}
      global.GraphUI = null;
    });
  }
  reload = function() {
    unload();
    init();
  };
  init();
  watchWindows2(addToolbarButton);
});

function shutdown(data, reason) {
  if (reason != APP_SHUTDOWN) {
    unload();
    unload2();
  }
}

function install() {}

function uninstall() {}
