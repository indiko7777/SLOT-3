// Catch synchronous launch parsing and failed module downloads as well as boot
// failures, so a bad/missing casino launch can never leave an unexplained blank.
void import("./main").catch(() => {
  document.body.replaceChildren();
  const alert = document.createElement("main");
  alert.setAttribute("role", "alert");
  alert.style.cssText = "min-height:100dvh;box-sizing:border-box;display:grid;place-content:center;gap:20px;padding:32px;background:#101b22;color:#fff0e2;font:18px/1.5 Arial,sans-serif;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "LET’S GET YOU BACK IN";
  const message = document.createElement("p");
  message.textContent = "The game could not open. Check your connection, then relaunch it from the casino.";
  const retry = document.createElement("button");
  retry.textContent = "RETRY";
  retry.style.cssText = "justify-self:center;border:0;padding:14px 32px;background:#f5c8a9;color:#101b22;font:700 16px Arial;cursor:pointer";
  retry.onclick = () => location.reload();
  alert.append(title, message, retry);
  document.body.append(alert);
});
