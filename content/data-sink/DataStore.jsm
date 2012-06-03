/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["DataStore"];

/**
 * The Data Store
 *
 * @param string aDBName
 *        The name of the database to be used for this session, both by
 *        Data Sink and the Graph UI.
 */
function DataStore(aDBName) {
  this._databaseInitiated = false;
  this.db = null;
  this.databaseName = aDBName;
  Components.classes["@mozilla.org/dom/indexeddb/manager;1"]
    .getService(Components.interfaces.nsIIndexedDatabaseManager)
    .initWindowless(this);
  this.init();
}

DataStore.prototype = {
  /**
   * The Data Store initialization code.
   */
  init: function DS_init()
  {
    let request = this.mozIndexedDB.open(this.databaseName, 1);
    request.onsuccess = function(event) {
      this.db = request.result;
      this._databaseInitiated = true;
    }.bind(this);
    request.onupgradeneeded = this.setupDataBase.bind(this);
  },

  /**
   * Function to setup the data base according to the normalized event data.
   */
  setupDataBase: function DS_setupDataBase(aEvent)
  {
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
  add: function DS_add(aNormalizedData)
  {
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
  getById: function DS_getById(aId, aCallback)
  {
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
  getRangeById: function DS_getRangeById(aCallback, aLowerId, aUpperId)
  {
    if (!this._databaseInitiated) {
      return false;
    }

    let range;
    if (aLowerId != null && aUpperId != null) {
      range = this.IDBKeyRange.bound(aLowerId, aUpperId);
    }
    else if (aLowerId == null && aUpperId != null) {
      range = this.IDBKeyRange.upperBound(aUpperId);
    }
    else if (aLowerId != null && aUpperId == null) {
      range = this.IDBKeyRange.lowerBound(aLowerId);
    }
    else {
      range = null;
    }

    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .openCursor(range, "next" /* IDBCursor.NEXT */)
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
  getByIndex: function DS_getByIndex(aIndexName, aIndexKey, aCallback)
  {
    if (!this._databaseInitiated) {
      return false;
    }
    let range = this.IDBKeyRange.key(aIndexKey);
    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .index(aIndexName)
          .openCursor(range, "next" /* IDBCursor.NEXT */)
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
  function DS_getRangeByIndex(aCallback, aIndexName, aLowerKey, aUpperKey)
  {
    if (!this._databaseInitiated) {
      return false;
    }
    let range;
    if (aLowerKey != null && aUpperKey != null) {
      range = this.IDBKeyRange.bound(aLowerKey, aUpperKey);
    }
    else if (aLowerKey == null && aUpperKey != null) {
      range = this.IDBKeyRange.upperBound(aUpperKey);
    }
    else if (aLowerKey != null && aUpperKey == null) {
      range = this.IDBKeyRange.lowerBound(aLowerKey);
    }
    else {
      range = null;
    }

    try {
      let data = [];
      this.db.transaction("normalizedData")
          .objectStore("normalizedData")
          .index(aIndexName)
          .openCursor(range, "next" /* IDBCursor.NEXT */)
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
   * @param boolean aDeleteDatabase
   *        true if user wants to delete the database just created.
   */
  destroy: function DS_destroy(aDeleteDatabase)
  {
    if (aDeleteDatabase === true) {
      this.mozIndexedDB.deleteDatabase(this.databaseName)
          .onsuccess = function(e){};
    }
    this.db.close();

    this._databaseInitiated = this.db = this.mozIndexedDB =
      this.IDBKeyRange = null;
  },
};
