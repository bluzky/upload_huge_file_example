class HugeUploader {
  constructor(params) {
    this.endpoint = params.endpoint;
    this.file = params.file;
    this.headers = params.headers || {};
    this.chunkSize = params.chunkSize || 5 * 1024 * 1024;
    this.retries = params.retries || 5;
    this.delayBeforeRetry = params.delayBeforeRetry || 5;
    this.md5 = params.md5;
    this.bodyParams = params.body || {};

    this.uploadId = null;
    this.etags = [];
    this.chunk = null;
    this.chunkCount = 0;
    this.totalChunks = Math.ceil(this.file.size / this.chunkSize);
    this.retriesCount = 0;
    this.offline = false;
    this.paused = false;

    // this.headers["uploader-file-id"] = this._uniqid(this.file);
    // this.headers["uploader-chunks-total"] = this.totalChunks;

    this._reader = new FileReader();
    this._eventTarget = new EventTarget();

    this._validateParams();

    // restart sync when back online
    // trigger events when offline/back online
    window.addEventListener("online", () => {
      if (!this.offline) return;

      this.offline = false;
      this._eventTarget.dispatchEvent(new Event("online"));
      this._sendChunks();
    });

    window.addEventListener("offline", () => {
      this.offline = true;
      this._eventTarget.dispatchEvent(new Event("offline"));
    });
  }

  /**
   * Subscribe to an event
   */
  on(eType, fn) {
    this._eventTarget.addEventListener(eType, fn);
  }

  /**
   * Validate params and throw error if not of the right type
   */
  _validateParams() {
    if (!this.endpoint || !this.endpoint.length)
      throw new TypeError("endpoint must be defined");
    if (this.file instanceof File === false)
      throw new TypeError("file must be a File object");
    if (this.headers && typeof this.headers !== "object")
      throw new TypeError("headers must be null or an object");
    if (
      this.chunkSize &&
      (typeof this.chunkSize !== "number" || this.chunkSize === 0)
    )
      throw new TypeError("chunkSize must be a positive number");
    if (
      this.retries &&
      (typeof this.retries !== "number" || this.retries === 0)
    )
      throw new TypeError("retries must be a positive number");
    if (this.delayBeforeRetry && typeof this.delayBeforeRetry !== "number")
      throw new TypeError("delayBeforeRetry must be a positive number");

    if (!this.md5) throw new TypeError("md5 cannot be null");
  }

  _initUpload() {
    const params = Object.assign(
      {
        file_name: this.file.name,
        file_size: this.file.size,
        md5: this.md5,
        chunk_count: this.totalChunks,
      },
      this.bodyParams
    );

    return fetch(`${this.endpoint}/init_upload`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then((response) => response.json())
      .then((json) => {
        this.uploadId = json.data.upload_id;
        return json;
      });
  }

  /**
   * Get portion of the file of x bytes corresponding to chunkSize
   */
  _getChunk() {
    return new Promise((resolve) => {
      const length = this.totalChunks === 1 ? this.file.size : this.chunkSize;
      const start = length * this.chunkCount;

      this._reader.onload = () => {
        this.chunk = new Blob([this._reader.result], {
          type: "application/octet-stream",
        });
        resolve();
      };

      this._reader.readAsArrayBuffer(this.file.slice(start, start + length));
    });
  }

  /**
   * Send chunk of the file with appropriate headers and add post parameters if it's last chunk
   */
  _sendChunk() {
    const form = new FormData();
    form.append("chunk_data", this.chunk);
    form.append("upload_id", this.uploadId);
    form.append("chunk_size", this.chunk.size);
    form.append("chunk_number", this.chunkCount);

    return fetch(`${this.endpoint}/upload_chunk`, {
      method: "POST",
      headers: this.headers,
      body: form,
    });
  }

  /**
   * Called on net failure. If retry counter !== 0, retry after delayBeforeRetry
   */
  _manageRetries() {
    if (this.retriesCount++ < this.retries) {
      setTimeout(() => this._sendChunks(), this.delayBeforeRetry * 1000);
      this._eventTarget.dispatchEvent(
        new CustomEvent("fileRetry", {
          detail: {
            message: `An error occured uploading chunk ${this.chunkCount}. ${
              this.retries - this.retriesCount
            } retries left`,
            chunk: this.chunkCount,
            retriesLeft: this.retries - this.retriesCount,
          },
        })
      );
      return;
    }

    this._eventTarget.dispatchEvent(
      new CustomEvent("error", {
        detail: `An error occured uploading chunk ${this.chunkCount}. No more retries, stopping upload`,
      })
    );
  }

  /**
   * Manage the whole upload by calling getChunk & sendChunk
   * handle errors & retries and dispatch events
   */
  _sendChunks() {
    if (this.paused || this.offline) return;

    this._getChunk()
      .then(() => this._sendChunk())
      .then((res) => {
        if (res.status === 200 || res.status === 201 || res.status === 204) {
          res
            .json()
            .then((body) => {
              this.etags.push(body.data.etag);
            })
            .then(() => {
              if (++this.chunkCount < this.totalChunks) {
                this._sendChunks();
              } else {
                this._completeUpload();
              }

              const percentProgress = Math.round(
                (100 / this.totalChunks) * this.chunkCount
              );
              this._eventTarget.dispatchEvent(
                new CustomEvent("progress", { detail: percentProgress })
              );
            });
        }

        // errors that might be temporary, wait a bit then retry
        else if ([408, 502, 503, 504].includes(res.status)) {
          if (this.paused || this.offline) return;
          this._manageRetries();
        } else {
          if (this.paused || this.offline) return;
          this._eventTarget.dispatchEvent(
            new CustomEvent("error", { detail: res })
          );
        }
      })
      .catch((err) => {
        if (this.paused || this.offline) return;

        // this type of error can happen after network disconnection on CORS setup
        this._manageRetries();
      });
  }

  _completeUpload() {
    const params = {
      upload_id: this.uploadId,
      etags: this.etags,
    };
    return fetch(`${this.endpoint}/complete_upload`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then((response) => response.json())
      .then((json) => {
        console.log(json);
        this._eventTarget.dispatchEvent(
          new CustomEvent("finish", { detail: json })
        );
      });
  }

  start() {
    this._initUpload().then(() => this._sendChunks());
  }

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this._sendChunks();
  }
}

function readChunked(file, chunkCallback, endCallback) {
  var fileSize = file.size;
  var chunkSize = 4 * 1024 * 1024; // 4MB
  var offset = 0;

  var reader = new FileReader();
  reader.onload = function () {
    if (reader.error) {
      endCallback(reader.error || {});
      return;
    }
    offset += reader.result.length;
    chunkCallback(reader.result, offset, fileSize);
    if (offset >= fileSize) {
      endCallback(null);
      return;
    }
    readNext();
  };

  reader.onerror = function (err) {
    endCallback(err || {});
  };

  function readNext() {
    var fileSlice = file.slice(offset, offset + chunkSize);
    reader.readAsBinaryString(fileSlice);
  }
  readNext();
}

function md5(blob, cbProgress) {
  return new Promise((resolve, reject) => {
    var md5 = CryptoJS.algo.MD5.create();
    readChunked(
      blob,
      (chunk, offs, total) => {
        md5.update(CryptoJS.enc.Latin1.parse(chunk));
        if (cbProgress) {
          cbProgress(offs / total);
        }
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          // TODO: Handle errors
          var hash = md5.finalize();
          var hashHex = hash.toString(CryptoJS.enc.Hex);
          resolve(hashHex);
        }
      }
    );
  });
}

export default HugeUploader;
export { md5 };
