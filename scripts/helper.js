/* ***** BEGIN LICENSE BLOCK *****
 *  This is the helper file for addon Search SpyBot
 *  Copyright (C) 2011  Girish Sharma
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/
 *
 *  The original code is the helper and utils file for addon Home Dash.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

// Helper that adds event listeners and remembers to remove on unload
function listen(window, node, event, func, capture) {
  // Default to use capture
  if (capture == null)
    capture = true;

  node.addEventListener(event, func, capture);
  function undoListen() {
    node.removeEventListener(event, func, capture);
  }

  // Undo the listener on unload and provide a way to undo everything
  let undoUnload = unload(undoListen, window);
  return function() {
    undoListen();
    undoUnload();
  };
}

// Async version of SpinQuery
// Enhanced by Girish Sharma
function spinQueryAsync(connection, {names, params, query}, {callback, args}) {
  // Remember the results from processing the query
  let allResults = [];

  // Nothing to do with no query
  if (query == null) {
    args[args.length] = allResults;
    callback(args);
    return;
  }

  // Create the statement and add parameters if necessary
  let statement = connection.createAsyncStatement(query);
  if (params != null) {
    Object.keys(params).forEach(function(key) {
      statement.params[key] = params[key];
    });
  }

  // Start the query and prepare to cancel if necessary
  let pending = statement.executeAsync({
    // Remember that we finished successfully
    handleCompletion: function handleCompletion(reason) {
      if (reason != Ci.mozIStorageStatementCallback.REASON_ERROR) {
        args[args.length] = allResults;
        callback(args);
      }
    },

    // Remember that we finished with an error
    handleError: function handleError(error) {
      throw error;
    },

    // Process the batch of results and save them for later
    handleResult: function handleResult(results) {
      let row;
      while ((row = results.getNextRow()) != null) {
        let item = {};
        names.forEach(function(name) {
          item[name] = row.getResultByName(name);
        });
        allResults.push(item);
      }
    },
  });
}

function unload(callback, container) {
  // Initialize the array of unloaders on the first usage
  let unloaders = unload.unloaders;
  if (unloaders == null)
    unloaders = unload.unloaders = [];

  // Calling with no arguments runs all the unloader callbacks
  if (callback == null) {
    unloaders.slice().forEach(function(unloader) unloader());
    unloaders.length = 0;
    return;
  }

  // The callback is bound to the lifetime of the container if we have one
  if (container != null) {
    // Remove the unloader when the container unloads
    container.addEventListener("unload", removeUnloader, false);

    // Wrap the callback to additionally remove the unload listener
    let origCallback = callback;
    callback = function() {
      container.removeEventListener("unload", removeUnloader, false);
      origCallback();
    }
  }

  // Wrap the callback in a function that ignores failures
  function unloader() {
    try {
      callback();
    }
    catch(ex) {}
  }
  unloaders.push(unloader);

  // Provide a way to remove the unloader
  function removeUnloader() {
    let index = unloaders.indexOf(unloader);
    if (index != -1)
      unloaders.splice(index, 1);
  }
  return removeUnloader;
}

function watchWindows(callback) {
  var unloaded = false;
  unload(function() unloaded = true);

  // Wrap the callback in a function that ignores failures
  function watcher(window) {
    try {
      // Now that the window has loaded, only handle browser windows
      let {documentElement} = window.document;
      if (documentElement.getAttribute("windowtype") == "navigator:browser")
        callback(window);
    }
    catch(ex) {}
  }

  // Wait for the window to finish loading before running the callback
  function runOnLoad(window) {
    // Listen for one load event before checking the window type
    window.addEventListener("load", function runOnce() {
      window.removeEventListener("load", runOnce, false);
      if (unloaded) return; // the extension has shutdown
      watcher(window);
    }, false);
  }

  // Add functionality to existing windows
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    // Only run the watcher immediately if the window is completely loaded
    let window = windows.getNext();
    if (window.document.readyState == "complete")
      watcher(window);
    // Wait for the window to load before continuing
    else
      runOnLoad(window);
  }

  // Watch for new browser windows opening then wait for it to load
  function windowWatcher(subject, topic) {
    if (topic == "domwindowopened")
      runOnLoad(subject);
  }
  Services.ww.registerNotification(windowWatcher);

  // Make sure to stop watching for windows if we're unloading
  unload(function() Services.ww.unregisterNotification(windowWatcher));
}

// Take a window and create various helper properties and functions
function makeWindowHelpers(window) {
  const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  let {document, clearTimeout, gBrowser, setTimeout} = window;

  // Call a function after waiting a little bit
  function async(callback, delay) {
    delay = delay || 0;
    let timer = setTimeout(function() {
      stopTimer();
      callback();
    }, delay);

    // Provide a way to stop an active timer
    function stopTimer() {
      if (timer == null)
        return;
      clearTimeout(timer);
      timer = null;
    }

    // Make sure to stop the timer when unloading
    unload(stopTimer, window);

    // Give the caller a way to cancel the timer
    return stopTimer;
  }

  // Replace a value with another value or a function of the original value
  function change(obj, prop, val) {
    let orig = obj[prop];
    obj[prop] = typeof val == "function" ? val(orig) : val;
    unload(function() obj[prop] = orig, window);
  }

  return {
    async: async,
    change: change,
  };
}

// function to trim the word and add ... in the middle
function trimWord(trimVal, limit, start) {
  if (trimVal == null)
    return null;
  function totalLength(parts) {
    let result = 0;
    for (let i = 0; i < parts.length; i++)
      result += parts[i].length + 1;
    return --result;
  }
  limit = limit || 40;
  let remWords = limit;
  if (start == null)
    start = true;

  if (trimVal.length > limit) {
    let valPart = trimVal.split(" ");
    let newVal = "";
    if (valPart.length > 1) {
      let index = -1;
      Array.some(valPart, function(v) {
        if (newVal.length > 2*limit/3)
          return true;
        else {
          if (newVal.length + v.length < 2*limit/3) {
            newVal += v + " ";
            remWords -= (v.length + 1);
            index++;
          }
          else return true;
        }
      });
      if (index == -1) {
        // Checking whether the rest of the words (except first) sum up big
        let tempLim = valPart[0].length/totalLength(valPart);
        newVal = trimWord(valPart[0], limit*tempLim, true) + " ";
        remWords -= newVal.length;
        index++;
      }
      if (valPart.length > 2) {
        newVal += "... ";
        remWords -= 4;
      }
      if (index < valPart.length - 1) {
        // Now adding the remaining words till limit is completed
        let lastIndex = valPart.length - 1;
        let endPart = "";
        while (remWords > valPart[lastIndex].length && lastIndex > index) {
          endPart = " " + valPart[lastIndex] + endPart;
          remWords -= (valPart[lastIndex--].length + 1);
        }
        if (lastIndex - index <= 1) {
          newVal = newVal.replace(" ... ", " ");
          remWords += 4;
        }
        if (lastIndex > index && remWords > 2)
          endPart = trimWord(valPart[lastIndex], remWords, false) + endPart;
        newVal += endPart;
      }
      return newVal;
    }
    else if (start == false)
      return (".." + trimVal.slice(trimVal.length - limit + 2, trimVal.length));
    else if (start == true)
      return (trimVal.slice(0, limit-2) + "..");
  }
  else return trimVal;
}

// Helper function to convert url's names to proper Sentances.
function makeCapital(word, len) {
  if (word != null) {
    let parts = word.split(" ");
    if (word.split(".").length > 2 && parts.length == 1)
      return word;
    if (parts.length == 1) {
      len = len || 1;
      if (parts[0].length > 2 && parts[0] != "and")
        return parts[0].substr(0,1).toUpperCase()+parts[0].substr(1);
      else if (len <= 2 || parts[0] == "i")
        return parts[0].toUpperCase();
      else
        return parts[0];
    }
    else {
      parts = parts.map(function(part) makeCapital(part, parts.length));
      return parts.join(" ");
    }
  }
  else
    return "";
}

// Checks if the current input is already a uri
function isURI(input) {
  if (input.match(/ /) == null) {
    try {
      // Quit early if the input is already a URI
      return Services.io.newURI(input, null, null);
    } catch(ex) {}

    try {
      // Quit early if the input is domain-like (e.g., site.com/page)
      return Cc["@mozilla.org/network/effective-tld-service;1"].
        getService(Ci.nsIEffectiveTLDService).
        getBaseDomainFromHost(input);
    } catch(ex) {}
  }
  return null;
}
