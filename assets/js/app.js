// We import the CSS which is extracted to its own file by esbuild.
// Remove this line if you add a your own CSS build pipeline (e.g postcss).
import "../css/app.css";

// If you want to use Phoenix channels, run `mix help phx.gen.channel`
// to get started and then uncomment the line below.
// import "./user_socket.js"

// You can include dependencies in two ways.
//
// The simplest option is to put them in assets/vendor and
// import them using relative paths:
//
//     import "../vendor/some-package.js"
//
// Alternatively, you can `npm install some-package --prefix assets` and import
// them using a path starting with the package name:
//
//     import "some-package"
//

// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html";
// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import topbar from "../vendor/topbar";
import HugeUploader, { md5 } from "./huge_upload.js";
// import md5File from "md5-file";

let csrfToken = document
  .querySelector("meta[name='csrf-token']")
  .getAttribute("content");
let liveSocket = new LiveSocket("/live", Socket, {
  params: { _csrf_token: csrfToken },
});

// Show progress bar on live navigation and form submits
topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", (info) => topbar.show());
window.addEventListener("phx:page-loading-stop", (info) => topbar.hide());

// connect if there are any LiveViews on the page
liveSocket.connect();

// expose liveSocket on window for web console debug logs and latency simulation:
// >> liveSocket.enableDebug()
// >> liveSocket.enableLatencySim(1000)  // enabled for duration of browser session
// >> liveSocket.disableLatencySim()
window.liveSocket = liveSocket;

let fileInput = document.getElementById("file-selector");

if (fileInput) {
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];

    document.getElementById("progress").innerHTML = "0%";
    document.getElementById("message").innerHTML =
      "Generating MD5 hash: " + file.name;
    /* Async usage */
    md5(file).then((hash) => {
      const uploader = new HugeUploader({
        endpoint: "http://localhost:4000/api/media",
        chunkSize: 3 * 1024 * 1024,
        file: file,
        md5: hash,
        headers: {
          Authorization:
            "Bearer SFMyNTY.g2gDdAAAAAFkAAd1c2VyX2lkbgcAAgSA8F3ojW4GAA3EEGeBAWIAAVGA.dRzALdSCZrKd1lsv2hlZyFQpcoRKscvzbT73zeltSYI",
        },
        body: {
          channel_id: "161049754137003364",
        },
      });
      uploader.on("finish", (e) => {
        document.getElementById("message").innerHTML =
          "Upload completed. File is located at: " + e.detail.file_path;
      });

      uploader.on("progress", (e) => {
        document.getElementById("progress").innerHTML = e.detail + "%";
      });
      document.getElementById("message").innerHTML =
        "Uploading file: " + file.name;
      uploader.start();
    });
  });
}
