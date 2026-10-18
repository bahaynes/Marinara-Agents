import assert from "node:assert/strict";
import { test } from "node:test";
import { INP_MAGIC, TEX_MAGIC, unpackInp, inspectPuppet, InpParseError } from "../inp-parser.mjs";

test("unpackInp fails on invalid magic bytes", () => {
  const badBuffer = Buffer.from("NOT_INP_HEADER_1234567890");
  assert.throws(() => unpackInp(badBuffer), InpParseError);
});

test("unpackInp and inspectPuppet successfully parse synthetic .inp buffer", () => {
  // Construct minimal valid .inp container in memory
  const docObj = {
    meta: {
      name: "TestModel",
      version: "v0.7.1",
      rigger: "Antigravity",
      artist: "TestArtist",
    },
    nodes: {
      uuid: 1,
      name: "Root",
      type: "Node",
      children: [
        { uuid: 2, name: "Body", type: "Part", children: [] },
        {
          uuid: 3,
          name: "Head",
          type: "Node",
          children: [
            { uuid: 4, name: "Eye:: Left", type: "Part" },
            { uuid: 5, name: "Mouth", type: "Part" },
          ],
        },
      ],
    },
    param: [
      { name: "Eye:: Blink", min: [0, 0], max: [1, 1], bindings: [{ node: 4 }] },
      { name: "Mouth:: Open", min: [0, 0], max: [1, 1], bindings: [{ node: 5 }] },
      { name: "Head:: Roll", min: [-1, 0], max: [1, 1], bindings: [{ node: 3 }] },
      { name: "Expression:: Happy", min: [0, 0], max: [1, 1], bindings: [{ node: 4 }] },
    ],
  };

  const jsonBuf = Buffer.from(JSON.stringify(docObj), "utf8");
  const texData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic stub

  // Calculate buffer size
  const totalLength = 8 + 4 + jsonBuf.length + 8 + 4 + (4 + 1 + texData.length);
  const buf = Buffer.alloc(totalLength);

  let offset = 0;
  buf.write(INP_MAGIC, offset, "utf8");
  offset += 8;

  buf.writeUInt32BE(jsonBuf.length, offset);
  offset += 4;
  jsonBuf.copy(buf, offset);
  offset += jsonBuf.length;

  buf.write(TEX_MAGIC, offset, "utf8");
  offset += 8;

  buf.writeUInt32BE(1, offset); // 1 texture
  offset += 4;

  buf.writeUInt32BE(texData.length, offset);
  offset += 4;
  buf.writeUInt8(0, offset); // PNG encoding
  offset += 1;
  texData.copy(buf, offset);

  // Unpack
  const { doc, textures } = unpackInp(buf);
  assert.equal(doc.meta.name, "TestModel");
  assert.equal(textures.length, 1);
  assert.equal(textures[0].encoding, 0);

  // Inspect
  const summary = inspectPuppet(doc, textures);
  assert.equal(summary.meta.name, "TestModel");
  assert.equal(summary.counts.nodesTotal, 5);
  assert.equal(summary.counts.partsTotal, 3);
  assert.equal(summary.counts.parametersTotal, 4);
  assert.equal(summary.parameters.eyes.length, 1);
  assert.equal(summary.parameters.mouth.length, 1);
  assert.equal(summary.parameters.head.length, 1);
  assert.equal(summary.parameters.expressions.length, 1);
});
