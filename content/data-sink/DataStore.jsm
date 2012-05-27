/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["DataStore"];

/**
 * The Data Store
 */
let DataStore = {

  _databaseInitiated: false,

  window: null,
  indexedDB: null,
  db: null,
  databaseName: "",

  /**
   * The Data Store initialization code.
   *
   * @param object aWindow
   *        The window to retreive the mozIndexedDB object.
   * @param string aDBName
   *        The name of the database to be used for this session, both by
   *        Data Sink and the Graph UI.
   */
  init: function DS_init(aWindow, aDBName) {
    if (!aWindow) {
      return;
    }

    this.window = aWindow;
    this.indexedDB = aWindow.mozIndexedDB;
    this.databaseName = aDBName;
    let request = this.indexedDB.open(aDBName, 1);
    request.onsuccess = function(event) {
      this.db = request.result;
      this._databaseInitiated = true;
    }.bind(this);
    request.onupgradeneeded = this.setupDataBase.bind(this);
  },

  /**
   * Function to setup the data base according to the normalized event data.
   */
  setupDataBase: function DS_setupDataBase(aEvent) {
    let db = aEvent.target.result;
    let objectStore = db.createObjectStore("normalizedData", { keyPath: "id" });

    objectStore.createIndex("groupID", "groupID", { unique: false });
    objectStore.createIndex("time", "time", { unique: false });
    objectStore.createIndex("producer", "producer", { unique: false });
    objectStore.createIndex("type", "type", { unique: false });
  },

  /**
   * Adds data to the object store.
   */
  add: function DS_add(aNormalizedData) {
    if (!this._databaseInitiated) {
      return false;
    }

    let transaction = this.db.transaction(["normalizedData"], "readwrite");

    let objectStore = transaction.objectStore("normalizedData");
    if (aNormalizedData instanceof Array) {
      for (let i = 0; i < aNormalizedData.length; i++) {
        let request = objectStore.add(aNormalizedData[i]);
        request.onsuccess = function(event) { };
      }
    }
    else {
      objectStore.add(aNormalizedData).onsuccess = function(event) {};
    }
    return true;
  },

  /**
   * Gets a single data from the object store based on the id.
   *
   * @param number aId
   *        id of the data to be retreived.
   * @param function aCallback
   *        Callback function which will handle the asynchrounously read data.
   */
  getById: function DS_getById(aId, aCallback) {
    if (!this._databaseInitiated) {
      return false;
    }
    this.db.transaction("normalizedData").objectStore("normalizedData")
        .get(aId).onsuccess = function(event) {
          aCallback(event.target.result);
        };
    return true;
  },

  /**
   * Gets a range of data from the object store based on the id bounds.
   *
   * @param function aCallback
   *        Callback function which will handle the asynchrounously read data.
   * @param number aLowerId
   *        Lower bound id of the data to retreive. null for no lower bound.
   * @param number aUpperId
   *        Upper bound id of the data to retreive. null for no upper bound.
   */
  getRangeById: function DS_getRangeById(aCallback, aLowerId, aUpperId) {
    if (!this._databaseInitiated) {
      return false;
    }
    let range;
    if (aLowerId != null && aUpperId != null) {
      range = this.window.IDBKeyRange.bound(aLowerId, aUpperId);
    }
    else if (aLowerId == null && aUpperId != null) {
      range = this.window.IDBKeyRange.upperBound(aUpperId);
    }
    else if (aLowerId != null && aUpperId == null) {
      range = this.window.IDBKeyRange.lowerBound(aLowerId);
    }
    else {
      range = null;
    }

    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .openCursor(range, this.window.IDBCursor.NEXT)
          .onsuccess = function(event) {
        let cursor = event.target.result;
        if (cursor) {
          data.push(cursor.value);
          cursor.continue();
        }
        else {
          aCallback(data);
        }
      };
    } catch (e) {
      Services.prompt.confirm(null, "", e);
      return false;
    }
    return true;
  },

  /**
   * Gets a range of data from the object store based on the provided index.
   *
   * @param string aIndexName
   *        Name of the index. Value can be one of the following:
   *        - groupId, time, producer and type.
   * @param string aIndexKey
   *        The value of the index for the required data.
   * @param function aCallback
   *        Callback function which will handle the asynchrounously read data.
   */
  getByIndex: function DS_getByIndex(aIndexName, aIndexKey, aCallback) {
    if (!this._databaseInitiated) {
      return false;
    }
    let range = this.window.IDBKeyRange.key(aIndexKey);
    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .index(aIndexName)
          .openCursor(range, this.window.IDBCursor.NEXT)
          .onsuccess = function(event) {
        let cursor = event.target.result;
        if (cursor) {
          data.push(cursor.value);
          cursor.continue();
        }
        else {
          aCallback(data);
        }
      };
    } catch (e) {
      return false;
    }
    return true;
  },

  /**
   * Gets a range of data from the object store based on the index bounds.
   *
   * @param function aCallback
   *        Callback function which will handle the asynchrounously read data.
   * @param string aIndexName
   *        Name of the index. Value can be one of the following:
   *        - groupId, time, producer and type.
   * @param number aLowerKey
   *        Lower bound id of the data to retreive. null for no lower bound.
   * @param number aUpperKey
   *        Upper bound id of the data to retreive. null for no upper bound.
   */
  getRangeByIndex:
  function DS_getRangeByIndex(aCallback, aIndexName, aLowerKey, aUpperKey) {
    if (!this._databaseInitiated) {
      return false;
    }
    let range;
    if (aLowerKey != null && aUpperKey != null) {
      range = this.window.IDBKeyRange.bound(aLowerKey, aUpperKey);
    }
    else if (aLowerKey == null && aUpperKey != null) {
      range = this.window.IDBKeyRange.upperBound(aUpperKey);
    }
    else if (aLowerKey != null && aUpperKey == null) {
      range = this.window.IDBKeyRange.lowerBound(aLowerKey);
    }
    else {
      range = null;
    }

    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .index(aIndexName)
          .openCursor(range, this.window.IDBCursor.NEXT)
          .onsuccess = function(event) {
        let cursor = event.target.result;
        if (cursor) {
          data.push(cursor.value);
          cursor.continue();
        }
        else {
          aCallback(data);
        }
      };
    } catch (e) {
      return false;
    }
    return true;
  },

  /**
   * Closes the database.
   *
   * @param boolean aDelete
   *        True if you want to delete the database.
   */
  destroy: function DS_destroy(aDelete) {
    if (aDelete === true) {
      this.indexedDB.deleteDatabase(this.databaseName)
          .onsuccess = function(e){ };
    }
    this.db.close();
    this._databaseInitiated = this.window = this.db = this.indexedDB = null;
  },
};
