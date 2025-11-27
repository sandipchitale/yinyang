// @ts-ignore
import primitives from '@jscad/modeling/src/primitives/index.js';
const { circle, rectangle, cuboid } = primitives;
// @ts-ignore
import extrusions from '@jscad/modeling/src/operations/extrusions/index.js';
const { extrudeLinear, extrudeRotate } = extrusions;
// @ts-ignore
import transforms from '@jscad/modeling/src/operations/transforms/index.js';
const { translate, rotateZ, rotateX } = transforms;
// @ts-ignore
import booleans from '@jscad/modeling/src/operations/booleans/index.js';
const { union, subtract, intersect } = booleans;
// @ts-ignore
import io from '@jscad/io/index.js';
const { stlSerializer } = io;
import * as fs from 'fs';

// Configuration
const CONFIG = {
  RADIUS: 10,
  HEIGHT: 0.2,
  SEGMENTS: 256,
  GAP: 0.2, // Clearance gap between Yin and Yang
  RAIL: {
    STEM_LENGTH: 0.6,
    HEAD_WIDTH: 0.8,
    HEAD_THICKNESS: 0.2,
    HEIGHT: 0.2, // Z-height of the rail (matches disc height)
    CLEARANCE: 0.2, // Clearance inside the groove
  },
  FRAME: {
    WIDTH: 1.2,
    HEIGHT: 2,
  }
};

// Helper to create the T-Rail 2D profile
const getTRailProfile = (radius: number, clearance: number = 0) => {
  const { STEM_LENGTH, HEAD_WIDTH, HEAD_THICKNESS, HEIGHT } = CONFIG.RAIL;
  
  // Unified Logic:
  // When clearance = 0, we get the exact rail dimensions.
  // When clearance > 0, we get the expanded cutter dimensions.
  
  // Stem Bounds
  const stemStart = radius - clearance;
  const stemEnd = radius + STEM_LENGTH;
  const stemWidth = stemEnd - stemStart;
  const stemHeight = HEIGHT + clearance * 2;
  const stemCenter = [stemStart + stemWidth / 2, 0];
  
  // Head Bounds
  const headStart = radius + STEM_LENGTH - clearance;
  const headEnd = radius + STEM_LENGTH + HEAD_THICKNESS + clearance;
  const headWidth = headEnd - headStart;
  const headHeight = HEAD_WIDTH + clearance * 2;
  const headCenter = [headStart + headWidth / 2, 0];
  
  const stem = rectangle({ size: [stemWidth, stemHeight], center: stemCenter });
  const head = rectangle({ size: [headWidth, headHeight], center: headCenter });
  
  return union(stem, head);
};

const createTRail = (radius: number, startAngle: number, angle: number) => {
  const profile = getTRailProfile(radius, 0);
  return extrudeRotate({ startAngle, angle, segments: CONFIG.SEGMENTS }, profile);
};

const createFrame = (radius: number) => {
  const { WIDTH, HEIGHT } = CONFIG.FRAME;
  
  // Ring Profile (Square)
  const innerRadius = radius + 0.2; // Start slightly offset from disc edge
  const profileX = innerRadius + WIDTH / 2;
  const ringProfile = rectangle({ size: [WIDTH, HEIGHT], center: [profileX, 0] });

  // Groove Profile (Cutter)
  const grooveProfile = getTRailProfile(radius, CONFIG.RAIL.CLEARANCE);
  
  // Create Solid Rings
  const yinRingSolid = extrudeRotate({ segments: CONFIG.SEGMENTS }, ringProfile);
  let yangRingSolid = extrudeRotate({ segments: CONFIG.SEGMENTS }, ringProfile);
  yangRingSolid = rotateX(Math.PI / 2, yangRingSolid);
  
  // Create Groove Cutters
  const yinGrooveCutter = extrudeRotate({ segments: CONFIG.SEGMENTS }, grooveProfile);
  let yangGrooveCutter = extrudeRotate({ segments: CONFIG.SEGMENTS }, grooveProfile);
  yangGrooveCutter = rotateX(Math.PI / 2, yangGrooveCutter);
  
  // Union Solid Rings first
  let frame = union(yinRingSolid, yangRingSolid);
  
  // Subtract Grooves
  frame = subtract(frame, yinGrooveCutter);
  frame = subtract(frame, yangGrooveCutter);
  
  return frame;
};

const createYinYangParts = () => {
  const { RADIUS, HEIGHT, GAP } = CONFIG;
  const smallRadius = RADIUS / 2;
  const dotRadius = RADIUS / 8;

  // Base Circle
  const baseCircle = circle({ radius: RADIUS, segments: 128 });

  // Split Rectangles
  const rightRect = translate([RADIUS / 2 + GAP/2, 0, 0], rectangle({ size: [RADIUS - GAP/2, RADIUS * 2] }));
  const leftRect = translate([-RADIUS / 2 - GAP/2, 0, 0], rectangle({ size: [RADIUS - GAP/2, RADIUS * 2] }));

  const rightHalf = intersect(baseCircle, rightRect);
  const leftHalf = intersect(baseCircle, leftRect);

  // S-Curve Circles
  const yinHeadRadius = smallRadius - GAP;
  const yinTailRadius = smallRadius + GAP;
  const yangHeadRadius = smallRadius - GAP;
  const yangTailRadius = smallRadius + GAP;

  const topCircleYinAdd = translate([0, smallRadius, 0], circle({ radius: yinHeadRadius, segments: 64 }));
  const bottomCircleYinSub = translate([0, -smallRadius, 0], circle({ radius: yinTailRadius, segments: 64 }));
  const bottomCircleYangAdd = translate([0, -smallRadius, 0], circle({ radius: yangHeadRadius, segments: 64 }));
  const topCircleYangSub = translate([0, smallRadius, 0], circle({ radius: yangTailRadius, segments: 64 }));
  
  // Dots (Holes)
  const topDot = translate([0, smallRadius, 0], circle({ radius: dotRadius, segments: 32 }));
  const bottomDot = translate([0, -smallRadius, 0], circle({ radius: dotRadius, segments: 32 }));

  // Yin Construction
  let yin2D = union(rightHalf, topCircleYinAdd);
  yin2D = subtract(yin2D, bottomCircleYinSub);
  yin2D = subtract(yin2D, topDot);

  // Yang Construction
  let yang2D = union(leftHalf, bottomCircleYangAdd);
  yang2D = subtract(yang2D, topCircleYangSub);
  yang2D = subtract(yang2D, bottomDot);

  // Extrude
  let yin3D = extrudeLinear({ height: HEIGHT }, yin2D);
  let yang3D = extrudeLinear({ height: HEIGHT }, yang2D);

  // Center in Z
  yin3D = translate([0, 0, -HEIGHT / 2], yin3D);
  yang3D = translate([0, 0, -HEIGHT / 2], yang3D);
  
  // Add T-Rails
  // Yin: -80 to 80 degrees (160 total)
  const yinRail = createTRail(RADIUS, -80 * Math.PI / 180, 160 * Math.PI / 180);
  yin3D = union(yin3D, yinRail);
  
  // Yang: 100 to 260 degrees (160 total)
  const yangRail = createTRail(RADIUS, 100 * Math.PI / 180, 160 * Math.PI / 180);
  yang3D = union(yang3D, yangRail);

  // Rotate Yang
  yang3D = rotateX(Math.PI / 2, yang3D);
  
  // Create Frame
  const frame = createFrame(RADIUS);

  return { yin3D, yang3D, frame };
};

const splitFrame = (frame: any, radius: number) => {
  const size = radius * 4; // Large enough to cover the frame
  const cutter = cuboid({ size: [size, size, size] });
  
  // Left Frame (Negative X)
  const leftCutter = translate([-size / 2, 0, 0], cutter);
  const frameLeft = intersect(frame, leftCutter);
  
  // Right Frame (Positive X)
  const rightCutter = translate([size / 2, 0, 0], cutter);
  const frameRight = intersect(frame, rightCutter);
  
  return { frameLeft, frameRight };
};

const exportSTL = (filename: string, solids: any) => {
  const rawData = stlSerializer.serialize({ binary: true }, solids);
  const buffer = Buffer.concat(rawData.map((chunk: any) => Buffer.from(chunk)));
  fs.writeFileSync(filename, buffer);
  console.log(`${filename} exported successfully`);
};

const main = () => {
  const { yin3D, yang3D, frame } = createYinYangParts();
  
  // Export Assembly
  exportSTL('yinyang_assembly.stl', [yin3D, yang3D, frame]);
  
  // Export Parts
  exportSTL('yin.stl', yin3D);
  exportSTL('yang.stl', yang3D);
  
  // Split Frame
  const { frameLeft, frameRight } = splitFrame(frame, CONFIG.RADIUS);
  exportSTL('frame_left.stl', frameLeft);
  exportSTL('frame_right.stl', frameRight);
};

main();
