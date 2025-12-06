// @ts-ignore
import primitives from '@jscad/modeling/src/primitives/index.js';
// @ts-ignore
import extrusions from '@jscad/modeling/src/operations/extrusions/index.js';
// @ts-ignore
import transforms from '@jscad/modeling/src/operations/transforms/index.js';
// @ts-ignore
import booleans from '@jscad/modeling/src/operations/booleans/index.js';
// @ts-ignore
import io from '@jscad/io/index.js';
import * as fs from 'fs';

const { circle, rectangle, cuboid, sphere, cylinder, polygon } = primitives;
const { extrudeLinear, extrudeRotate } = extrusions;
const { translate, rotateZ, rotateX, rotateY } = transforms;
const { union, subtract, intersect } = booleans;
const { stlSerializer } = io;

// Configuration
const CONFIG = {
  RADIUS: 10,
  HEIGHT: 0.2,
  SEGMENTS: 128, // Reduced for performance with gears
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
  },
  GEARS: {
    COUNT: 24, // Double teeth
    MODULE: 0.1,
    THICKNESS: 0.3,
    HOLE_RADIUS: 0.15,
    DISTANCE_FROM_INTERSECTION: 1.5, // How far along the rail from crossing
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
  
  // @ts-ignore
  const stem = rectangle({ size: [stemWidth, stemHeight], center: stemCenter });
  // @ts-ignore
  const head = rectangle({ size: [headWidth, headHeight], center: headCenter });
  
  return union(stem, head);
};

const getGearProfile = (toothCount: number, module: number, holeRadius: number) => {
  const pitchRadius = toothCount * module / 2;
  const outerRadius = pitchRadius + module;
  const rootRadius = pitchRadius - 1.25 * module;
  
  // @ts-ignore
  const points: [number, number][] = [];
  const stepsPerTooth = 4;
  const totalSteps = toothCount * stepsPerTooth;
  
  for (let i = 0; i < totalSteps; i++) {
    const angle = (i / totalSteps) * Math.PI * 2;
    const toothPhase = i % stepsPerTooth;
    let r = rootRadius;
    
    // Trapezoidal tooth profile approximation
    if (toothPhase === 1) r = outerRadius;
    if (toothPhase === 2) r = outerRadius;
    if (toothPhase === 3) r = rootRadius;
    
    points.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  
  // Subtract hole
  const gearShape = polygon({ points });
  // JSCAD V2 boolean logic usually requires strict types. 
  // We'll create the hole as a separate shape and subtract in 3D or 2D.
  // Let's do 2D subtract if possible, but polygon doesn't support holes easily in this primitive API.
  // We will subtract the cylinder in 3D.
  
  return gearShape;
};

const getGearPlacement = (radius: number, xSign: number, ySign: number, zSign: number) => {
  const { RADIUS, RAIL, GEARS } = CONFIG;
  
  const gearPitchRadius = (GEARS.COUNT * GEARS.MODULE) / 2;
  const offset = (RAIL.HEAD_WIDTH / 2) + gearPitchRadius;
  const headCenterR = RADIUS + RAIL.STEM_LENGTH + RAIL.HEAD_THICKNESS / 2;

  const y = ySign * offset;
  const z = zSign * offset;

  // Accurate X Position
  const xSq = headCenterR * headCenterR - y * y;
  const x = (xSq > 0) ? xSign * Math.sqrt(xSq) : xSign * headCenterR;

  return { x, y, z };
};

const createGear = () => {
  const { COUNT, MODULE, THICKNESS, HOLE_RADIUS } = CONFIG.GEARS;
  const profile = getGearProfile(COUNT, MODULE, HOLE_RADIUS);
  // @ts-ignore
  let gearDisk = extrudeLinear({ height: THICKNESS }, profile);
  
  const hole = cylinder({ radius: HOLE_RADIUS, height: THICKNESS * 2 });
  // @ts-ignore
  gearDisk = subtract(gearDisk, hole);
  
  // Add Visual Hole (Off-Center)
  // Pitch approx COUNT*MODULE/2.
  const visualHoleR = MODULE * 0.8;
  const visualHoleDist = (COUNT * MODULE / 4); // Halfway to rim
  const visualHole = translate([visualHoleDist, 0, 0], cylinder({ radius: visualHoleR, height: THICKNESS * 2 }));
  // @ts-ignore
  gearDisk = subtract(gearDisk, visualHole);
  
  // Center it in Z
  gearDisk = translate([0, 0, -THICKNESS / 2], gearDisk);
  
  // Add Axle to clear frame
  // Frame Outer Radius ~ 11.4. Inner Gear at ~10.7. Gap ~0.7.
  // Use 1.2 for safe clearance.
  const axleExtension = 1.2;
  const axleRadius = 0.2;

  let axle = cylinder({ radius: axleRadius, height: axleExtension });
  // Axle starts at THICKNESS/2
  axle = translate([0, 0, THICKNESS / 2 + axleExtension / 2], axle);
  
  // Add Second Gear (Outer)
  // Positioned at end of axle
  const outerGear = translate([0, 0, THICKNESS + axleExtension], gearDisk);

  // @ts-ignore
  return union([gearDisk, axle, outerGear]);
};

// Create rail teeth
const createRailTeeth = (radius: number, startAngle: number, angle: number) => {
  const { MODULE } = CONFIG.GEARS;
  // Teeth on Top (Z+) and Bottom (Z-) of the Head.
  // Head Z-width is CONFIG.RAIL.HEAD_WIDTH.
  // Center is Z=0.
  // Top Face is at Z = +HEAD_WIDTH/2.
  // Bottom Face is at Z = -HEAD_WIDTH/2.
  
  // Radial position: Center of Head is Radius + STEM + HEAD_THICKNESS/2.
  // Width of teeth: HEAD_THICKNESS (Radial width).
  
  const headCenterR = radius + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS / 2;
  const headRadialWidth = CONFIG.RAIL.HEAD_THICKNESS;
  
  const zTop = CONFIG.RAIL.HEAD_WIDTH / 2;
  const zBottom = -CONFIG.RAIL.HEAD_WIDTH / 2;
  
  const perimeter = headCenterR * angle;
  const pitch = Math.PI * MODULE;
  const toothCount = Math.floor(perimeter / pitch);
  
  // @ts-ignore
  let teeth: any[] = [];
  
  // Tooth Base Shape
  // Ridge along Radial (X).
  // Dimensions: X=HeadThickness, Y=Module/2 (thickness), Z=Module (height).
  // We want the tooth to stick OUT in Z.
  const baseTooth = cuboid({ size: [headRadialWidth, MODULE / 1.5, MODULE] });
  
  for (let i = 0; i < toothCount; i++) {
    const theta = startAngle + (i / toothCount) * angle;

    // Positions
    // We need to rotate the position around Z axis.
    
    // Top Tooth
    // Position at (R, 0, Z_top + module/2).
    let tTop = translate([headCenterR, 0, zTop ], baseTooth);
    tTop = rotateZ(theta, tTop);
    teeth.push(tTop);
    
    // Bottom Tooth
    // Position at (R, 0, Z_bottom - module/2).
    let tBottom = translate([headCenterR, 0, zBottom], baseTooth);
    tBottom = rotateZ(theta, tBottom);
    teeth.push(tBottom);
  }
  
  // @ts-ignore
  return union(teeth);
};

const createTRail = (radius: number, startAngle: number, angle: number, withTeeth: boolean = false) => {
  const profile = getTRailProfile(radius, 0);
  let rail = extrudeRotate({ startAngle, angle, segments: CONFIG.SEGMENTS }, profile);
  
  if (withTeeth) {
    const teeth = createRailTeeth(radius, startAngle, angle);
    // @ts-ignore
    rail = union(rail, teeth);
  }
  return rail;
};

const createFrame = (radius: number) => {
  const { WIDTH, HEIGHT } = CONFIG.FRAME;
  const { DISTANCE_FROM_INTERSECTION, MODULE, THICKNESS } = CONFIG.GEARS;
  
  // Ring Profile
  const innerRadius = radius + 0.2; 
  const profileX = innerRadius + WIDTH / 2;
  // @ts-ignore
  const ringProfile = rectangle({ size: [WIDTH, HEIGHT], center: [profileX, 0] });

  // Groove Profile
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
  // @ts-ignore
  let frame = union(yinRingSolid, yangRingSolid);
  
  // Subtract Grooves
  // @ts-ignore
  frame = subtract(frame, yinGrooveCutter);
  // @ts-ignore
  frame = subtract(frame, yangGrooveCutter);
  
  // Create Slits for Gears (Corner Placement)
  // Gears are at (+/- Offset, +/- Offset) in YZ plane.
  // Offset = HeadWidth/2 + PitchR.
  
  const corners = [-1, 1];
  
  // Cutter Dimensions
  // Thickness (X): Reduced clearance. Gear Thick + 0.1.
  const slitThickness = CONFIG.GEARS.THICKNESS + 0.1; 
  // Face (Y/Z): Outer Diameter + Reduced Clearance (0.3).
  const slitFaceSize = ((CONFIG.GEARS.COUNT * CONFIG.GEARS.MODULE / 2) + CONFIG.GEARS.MODULE) * 2 + 0.3; 
  
  // @ts-ignore
  const slitCutters: any[] = [];
  

  [radius, -radius].forEach(xBase => {
    // Cutter Dimensions
    const slitThickness = CONFIG.GEARS.THICKNESS + 0.1; 
    const slitFaceSize = ((CONFIG.GEARS.COUNT * CONFIG.GEARS.MODULE / 2) + CONFIG.GEARS.MODULE) * 2 + 0.3; 
    
    // @ts-ignore
    const cutter = cuboid({ size: [slitThickness, slitFaceSize, slitFaceSize] });

      const xSign = Math.sign(xBase);
      corners.forEach(ySign => {
          corners.forEach(zSign => {
               if (ySign === zSign) return;
               const { x, y, z } = getGearPlacement(radius, xSign, ySign, zSign);
               // @ts-ignore
               slitCutters.push(translate([x, y, z], cutter));
          });
      });
  });
  
  // Subtract Slits
  // @ts-ignore
  if (slitCutters.length > 0) {
      // @ts-ignore
      const allSlits = union(slitCutters);
      // @ts-ignore
      frame = subtract(frame, allSlits);
  }

  // Create Axle Supports (Corner Brackets connected to Frame Rings)
  // Connects the rings to the gear axle lines
  // @ts-ignore
  const supports: any[] = [];
  const supportThickness = 0.4; // Along the axle axis
  const axleClearance = 0.25; // Radius of hole for axle
  const frameHeight = CONFIG.FRAME.HEIGHT; // 2.0, so extends +/- 1.0

  [radius, -radius].forEach(xBase => {
      const xSign = Math.sign(xBase);
      corners.forEach(ySign => {
          corners.forEach(zSign => {
              if (ySign === zSign) return;

              const { x, y, z } = getGearPlacement(radius, xSign, ySign, zSign);
              
              // Position along Axle (X)
              const supportCenterX = x + xSign * (0.2 + supportThickness / 2);
              
              // 1. Hub (Wraps around axle)
              const hubRadius = 0.7;
              // @ts-ignore
              let hub = rotateY(Math.PI/2, cylinder({ radius: hubRadius, height: supportThickness }));
              // @ts-ignore
              hub = translate([supportCenterX, y, z], hub);
              
              // 2. Strut to Yin Ring (XY Plane, Z=0)
              // Ring Z-extents are [-1, 1]. Gear Z is ~1.6.
              // Connect from Hub (Z=1.6) down to Ring Top (Z=1.0).
              const zRingEdge = zSign * (frameHeight / 2 - 0.1); // Overlap slightly
              const strutZCenter = (z + zRingEdge) / 2;
              const strutZHeight = Math.abs(z - zRingEdge);
              // Width matches Hub
              // @ts-ignore
              const strutZ = cuboid({ size: [supportThickness, hubRadius * 1.8, strutZHeight], center: [supportCenterX, y, strutZCenter] });
              
              // 3. Strut to Yang Ring (XZ Plane, Y=0)
              // Ring Y-extents are [-1, 1]. Gear Y is ~1.6.
              const yRingEdge = ySign * (frameHeight / 2 - 0.1);
              const strutYCenter = (y + yRingEdge) / 2;
              const strutYHeight = Math.abs(y - yRingEdge);
              // @ts-ignore
              const strutY = cuboid({ size: [supportThickness, strutYHeight, hubRadius * 1.8], center: [supportCenterX, strutYCenter, z] });
              
              // @ts-ignore
              let bracket = union([hub, strutZ, strutY]);
              
              // Axle Hole
              // @ts-ignore
              const hole = translate([supportCenterX, y, z], rotateY(Math.PI/2, cylinder({ radius: axleClearance, height: supportThickness * 2 })));
              
              // @ts-ignore
              bracket = subtract(bracket, hole);
              
              supports.push(bracket);
          });
      });
  });

  if (supports.length > 0) {
      // @ts-ignore
      const allSupports = union(supports);
      // Union with frame
      // @ts-ignore
      frame = union(frame, allSupports);
  }
  
  return { frame, yinRingSolid, yangRingSolid };
};

const createGlassPanels = (radius: number, yinRingSolid: any, yangRingSolid: any) => {
  // Glass Sphere Shell
  // Modified to match Inner Frame Radius as requested.
  // Frame Inner Radius is radius + 0.2 (10.2).
  // Inner Radius: radius + 0.2 (10.2) -> Matches Frame Inner surface.
  // Outer Radius: radius + 0.4 (10.4) -> Thickness 0.2.
  // Gears are at ~10.7 (Center) to ~11.3 (Outer).
  // Sphere Outer (10.4) is well clear of Gears (10.7).
  
  const innerRadius = radius + 0.2;
  const outerRadius = radius + 0.4;
  
  const outerSphere = sphere({ radius: outerRadius, segments: 64 });
  const innerSphere = sphere({ radius: innerRadius, segments: 64 });
  
  // @ts-ignore
  let glassSphere = subtract(outerSphere, innerSphere);
  
  // Subtract the Solid Frame Rings
  // @ts-ignore
  glassSphere = subtract(glassSphere, yinRingSolid);
  // @ts-ignore
  glassSphere = subtract(glassSphere, yangRingSolid);
  
  // Explicitly cut the Tracks (Grooves) to ensure clearance
  // Even if Frame Rings overlaps, this ensures the specific profile is clear.
  const grooveProfile = getTRailProfile(radius, CONFIG.RAIL.CLEARANCE);
  // @ts-ignore
  const yinGroove = extrudeRotate({ segments: CONFIG.SEGMENTS }, grooveProfile);
  // @ts-ignore
  let yangGroove = extrudeRotate({ segments: CONFIG.SEGMENTS }, grooveProfile);
  yangGroove = rotateX(Math.PI / 2, yangGroove);
  
  // @ts-ignore
  glassSphere = subtract(glassSphere, yinGroove);
  // @ts-ignore
  glassSphere = subtract(glassSphere, yangGroove);
  
  return glassSphere;
};

const createYinYangParts = () => {
  const { RADIUS, HEIGHT, GAP, GEARS } = CONFIG;

  // Add T-Rails with Teeth on Z-faces
  // Yin: -86 to 86 degrees (172 total) - Further shortened as requested
  const yinRail = createTRail(RADIUS, -86 * Math.PI / 180, 172 * Math.PI / 180, true);
  let yin3D = yinRail;
  
  // Yang: 94 to 266 degrees (172 total) - Further shortened as requested
  const yangRail = createTRail(RADIUS, 94 * Math.PI / 180, 172 * Math.PI / 180, true);
  let yang3D = yangRail;
  yang3D = rotateX(Math.PI / 2, yang3D);
  
  // Create Frame and Glass Panels
  const { frame, yinRingSolid, yangRingSolid } = createFrame(RADIUS);
  const glassPanels = createGlassPanels(RADIUS, yinRingSolid, yangRingSolid);

  // Generate Gears

  // Generate Gears
  const baseGear = createGear();
  // @ts-ignore
  const gears: any[] = [];
  
  const corners = [-1, 1];
  
  [RADIUS, -RADIUS].forEach(xBase => {
    const xSign = Math.sign(xBase);
    
    corners.forEach(ySign => {
      corners.forEach(zSign => {
          // Filter Gears: Flip to Anti-Diagonal (Mixed Signs).
          // Keep if ySign != zSign.
          if (ySign === zSign) return;

          const { x, y, z } = getGearPlacement(RADIUS, xSign, ySign, zSign);
          
          // Rotation
          // Axis is roughly X axis (Radial).
          // We'll trust the "Radial Axis" logic implies roughly Pointing Outward.
          
          let g = rotateY(Math.PI / 2, baseGear); // Axis X
          
          // @ts-ignore
          g = translate([x, y, z], g);
          gears.push(g);
      });
    });
  });

  // @ts-ignore
  return { yin3D, yang3D, frame, glassPanels, gears: union(gears) };
};

const splitFrame = (frame: any, radius: number) => {
  const size = radius * 4; // Large enough to cover the frame
  const cutter = cuboid({ size: [size, size, size] });
  
  // Left Frame (Negative X)
  const leftCutter = translate([-size / 2, 0, 0], cutter);
  // @ts-ignore
  const frameLeft = intersect(frame, leftCutter);
  
  // Right Frame (Positive X)
  const rightCutter = translate([size / 2, 0, 0], cutter);
  // @ts-ignore
  const frameRight = intersect(frame, rightCutter);
  
  return { frameLeft, frameRight };
};

const exportSTL = (filename: string, solids: any) => {
  const rawData = stlSerializer.serialize({ binary: true }, solids);
  // @ts-ignore
  const buffer = Buffer.concat(rawData.map((chunk: any) => Buffer.from(chunk)));
  fs.writeFileSync(filename, buffer);
  console.log(`${filename} exported successfully`);
};

const main = () => {
  // @ts-ignore
  const { yin3D, yang3D, frame, glassPanels, gears } = createYinYangParts();
  
  // Export Assembly
  exportSTL('yinyang_assembly.stl', [yin3D, yang3D, frame, glassPanels, gears]);
  
  // Export Parts
  exportSTL('yin.stl', yin3D);
  exportSTL('yang.stl', yang3D);
  exportSTL('glass_panels.stl', glassPanels);
  exportSTL('gears.stl', gears);
  
  // Export Single Gear
  const singleGear = createGear();
  exportSTL('gear.stl', singleGear);
  
  // Split Frame
  const { frameLeft, frameRight } = splitFrame(frame, CONFIG.RADIUS);
  exportSTL('frame_left.stl', frameLeft);
  exportSTL('frame_right.stl', frameRight);
};

main();
