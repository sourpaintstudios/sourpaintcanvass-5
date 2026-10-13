import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import "@/canvas-app.css";

export const Route = createFileRoute("/")({ component: Home });

const MARKUP = `<div id="stage"><div id="wrap">
  <div id="bgfill"></div>
  <canvas id="paint"></canvas><canvas id="tex"></canvas><canvas id="ui"></canvas><canvas id="mask"></canvas>
</div></div>
<div id="hud">
  <div class="row"><div id="status">Tap Start, then play.</div>
    <button id="start" class="hot" type="button">Start</button><button id="pause" type="button" disabled>Pause</button></div>
  <div class="row"><button id="colorsBtn" type="button"><span>Colors</span><span id="strip"></span></button>
    <button id="clear" type="button">Clear</button><button id="save" type="button">Save PNG</button></div>
  <div class="row"><div id="vstat">Video records while you play.</div>
    <button id="liveBtn" type="button" disabled>Live Video</button><button id="tlBtn" type="button" disabled>Time-lapse</button></div>
  <div class="row"><span style="font-size:12px;opacity:.8">Mic sensitivity</span><input type="range" id="sens" min="1" max="10" value="5" style="flex:1"></div>
  <div class="row" id="modes"></div>
  <div class="row" id="masks"></div>
  <div class="row" id="masktools">
    <button id="maskIn" type="button">Inside</button>
    <button id="maskOut" type="button">Around</button>
    <button id="maskRev" type="button">Reverse</button>
    <button id="maskLift" type="button">Lift mask</button>
  </div>
  <div class="row" id="bgrow"><button class="dot" type="button" data-bg="#f3efe6" style="background:#f3efe6" title="Cream"></button>
    <button class="dot" type="button" data-bg="#8d8d8d" style="background:#8d8d8d" title="Gray"></button>
    <button class="dot" type="button" data-bg="#3a3a3a" style="background:#3a3a3a" title="Dark gray"></button>
    <button class="dot" type="button" data-bg="#0d0d0d" style="background:#0d0d0d" title="Black"></button>
    <button id="wild" type="button" style="flex:1">Wildcard</button><button id="signBtn" type="button">DLR ✓</button></div>
</div>
<div id="sheet" hidden>
  <div id="sheetBody">
    <h2 id="sheetTitle">Colors</h2>
    <p class="note" id="sheetNote">Painting is paused. Tap colors to build your own set. Everything painted uses only those colors.</p>
    <h2>Your colors</h2><div id="chosen"></div>
    <h2>Pick colors</h2><div id="grid"></div>
    <div id="custom"><input type="color" id="cpick" value="#2a6fdb"><button id="cadd" type="button">Add this color</button><button id="cclear" type="button">Clear all</button></div>
    <h2>Palettes</h2><div id="pals"></div>
  </div>
  <div id="sheetBar"><button id="sheetDone" class="hot" type="button">Resume painting</button></div>
</div>`;

function Home() {
  useEffect(() => {
    const w = window as Window & { __spsCanvas?: boolean; __spsMask?: boolean };
    if (w.__spsCanvas && !w.__spsMask) {
      w.__spsMask = true;
      window.location.reload();
      return;
    }
    if (document.querySelector('script[data-sps="masks1"]')) return;
    const script = document.createElement("script");
    script.src = "/canvas.js?v=masks2";
    script.dataset.sps = "masks2";
    script.async = false;
    document.body.appendChild(script);
  }, []);

  return <div id="sps" dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
