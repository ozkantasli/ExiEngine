// ExiEngine unit test — BitmapFont (BMFont text/JSON) and BitmapText
import { test } from "node:test";
import assert from "node:assert/strict";
import { BitmapFont, BitmapText, Camera, MAX_BITMAP_TEXT_LENGTH, Scene, SpriteBatch, Texture, parseBitmapFontText } from "../../src/index.js";

function fontSource({ pages = 1 } = {}) {
  let source = 'info face="Test Sans" size=16 bold=0\ncommon lineHeight=20 base=16 scaleW=256 scaleH=64 pages=' + pages + '\npage id=0 file="test.png"\nchars count=10\n';
  [..."ABCDEFGH ?"].forEach((character, index) => {
    const empty = character === " ";
    source += `char id=${character.codePointAt(0)} x=${index * 16} y=0 width=${empty ? 0 : 10} height=${empty ? 0 : 14} xoffset=1 yoffset=2 xadvance=12 page=0 chnl=15\n`;
  });
  return `${source}kernings count=1\nkerning first=65 second=66 amount=-3\n`;
}
const fontTexture = () => new Texture({ id: "test-font", sourceWidth: 256, sourceHeight: 64 });

test("bitmap font: parses BMFont text and JSON with kerning", () => {
  const parsed = parseBitmapFontText(fontSource());
  assert.equal(parsed.info.face, "Test Sans");
  assert.equal(parsed.chars.length, 10);
  const font = BitmapFont.fromText(fontTexture(), fontSource());
  assert.equal(font.face, "Test Sans");
  assert.equal(font.lineHeight, 20);
  assert.equal(font.getKerning(65, 66), -3);
  assert.equal(font.getGlyph(65).frame.u0, 0);
  const fromJson = BitmapFont.fromJSON(fontTexture(), { info: { face: "J", size: 8 }, common: { lineHeight: 10, base: 8 }, pages: ["x.png"], chars: [{ id: 65, x: 0, y: 0, width: 4, height: 6, xadvance: 5 }], kernings: [] });
  assert.equal(fromJson.measure("AA").width, 10);
});

test("bitmap font: layout handles kerning, newlines, wrapping, alignment and missing glyphs", () => {
  const font = BitmapFont.fromText(fontTexture(), fontSource());
  const simple = font.layout("AB C");
  assert.deepEqual(simple.placements.map((item) => item.x), [1, 10, 34]);
  assert.equal(simple.width, 45);
  const wrapped = font.layout("ABC DEF GH", { maxWidth: 40 });
  assert.equal(wrapped.lines, 3);
  assert.deepEqual(wrapped.placements.filter((item) => item.line === 1).map((item) => item.x), [1, 13, 25]);
  const longWord = font.layout("ABCDEFGH", { maxWidth: 30 });
  assert.ok(longWord.lines >= 3, "a word longer than maxWidth is broken");
  const centered = font.layout("A\nABC", { align: "center" });
  assert.equal(centered.placements[0].x, 1 + (33 - 12) / 2, "short line shifted by half the width difference");
  const right = font.layout("A\nAB", { align: "right" });
  assert.ok(right.placements[0].x > right.placements[1].x);
  const missing = font.layout("AZ");
  assert.equal(missing.missing, 1);
  assert.equal(missing.placements.length, 2, "missing glyphs fall back to ?");
  assert.equal(font.layout("A", { lineHeight: 30, letterSpacing: 2 }).height, 30);
  assert.throws(() => font.layout("A", { align: "justify" }), /align/);
  assert.throws(() => font.layout("x".repeat(MAX_BITMAP_TEXT_LENGTH + 1)), /length limit/);
});

test("bitmap font: rejects unsafe or unsupported data", () => {
  const texture = fontTexture();
  assert.throws(() => new BitmapFont({}, fontSource()), /Texture/);
  assert.throws(() => new BitmapFont(texture, null), /BMFont/);
  assert.throws(() => new BitmapFont(texture, { chars: [] }), /non-empty/);
  assert.throws(() => BitmapFont.fromText(texture, fontSource({ pages: 2 })), /single-page/);
  assert.throws(() => new BitmapFont(texture, { chars: [{ id: 65, x: 250, y: 0, width: 10, height: 10 }] }), /outside the font texture/);
  assert.throws(() => new BitmapFont(texture, { chars: [{ id: "x" }] }), /integer/);
  assert.throws(() => new BitmapFont(texture, { chars: [{ id: 65, page: 1 }] }), /single-page/);
  assert.throws(() => parseBitmapFontText(42), /string/);
});

test("bitmap text: draws one batch of glyph quads and relayouts on change", () => {
  const font = BitmapFont.fromText(fontTexture(), fontSource());
  const label = new BitmapText({ font, text: "ABC", tint: 0xff0000, anchorX: 0.5, x: 100, y: 50 });
  assert.ok(label instanceof SpriteBatch);
  assert.equal(label.count, 3);
  assert.equal(label.textWidth, 33);
  assert.equal(label.sprites[0].x, 1 - 16.5);
  assert.equal(label.sprites[0].tint, 0xff0000);
  label.setText("AB C");
  assert.equal(label.count, 3, "spaces have no quad");
  label.text = "A";
  assert.equal(label.text, "A");
  label.setStyle({ anchorX: 0, tint: 0x00ff00 });
  assert.equal(label.sprites[0].x, 1);
  assert.equal(label.sprites[0].tint, 0x00ff00);
  const scene = new Scene();
  scene.add(label);
  scene.updateWorldMatrix();
  const items = label.getRenderItems(new Camera({ width: 320, height: 180 }), 320, 180);
  assert.ok(items.length >= 1, "renders through the SpriteBatch path");
  assert.throws(() => new BitmapText({ text: "x" }), /BitmapFont/);
  font.destroy();
  assert.throws(() => new BitmapText({ font }), /BitmapFont/);
});
