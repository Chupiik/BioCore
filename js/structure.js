// Draws a 2D structure from a SMILES string with SmilesDrawer's SvgDrawer
// (vendored in js/vendor, MIT licence).
const WIDTH = 420;
const HEIGHT = 280;
const SVG_NS = "http://www.w3.org/2000/svg";

export function drawStructure(host, smiles) {
  host.replaceChildren();
  if (typeof SmilesDrawer === "undefined") {
    host.textContent = smiles;
    return;
  }
  const text = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#fff";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("role", "img");
  host.append(svg);
  try {
    const drawer = new SmilesDrawer.SvgDrawer({
      width: WIDTH, height: HEIGHT, padding: 24, bondThickness: 2.2,
      themes: {
        biocore: {
          C: text, H: text, O: "#ff6b7a", N: "#6b9bff", S: "#ffcf5c", P: "#ff9f43", F: "#3ddc97", CL: "#3ddc97",
          BR: "#c0794e", I: "#a77bf3", BACKGROUND: "transparent",
        },
      },
    });
    SmilesDrawer.parse(smiles, tree => drawer.draw(tree, svg, "biocore"), () => { host.textContent = smiles; });
  } catch (e) {
    host.textContent = smiles;
  }
}
