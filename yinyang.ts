// @ts-ignore
import primitives from '@jscad/modeling/src/primitives/index.js';
const { circle, rectangle, cuboid, sphere, cylinder, polygon } = primitives;
// @ts-ignore
import extrusions from '@jscad/modeling/src/operations/extrusions/index.js';
const { extrudeLinear, extrudeRotate } = extrusions;
// @ts-ignore
import transforms from '@jscad/modeling/src/operations/transforms/index.js';
const { translate, rotateZ, rotateX, rotateY } = transforms;
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

const createGear = () => {
  const { COUNT, MODULE, THICKNESS, HOLE_RADIUS } = CONFIG.GEARS;
  const profile = getGearProfile(COUNT, MODULE, HOLE_RADIUS);
  let gear = extrudeLinear({ height: THICKNESS }, profile);
  
  const hole = cylinder({ radius: HOLE_RADIUS, height: THICKNESS * 2 });
  // @ts-ignore
  gear = subtract(gear, hole);
  
  // Add Visual Hole (Off-Center)
  // Pitch approx COUNT*MODULE/2.
  const visualHoleR = MODULE * 0.8;
  const visualHoleDist = (COUNT * MODULE / 4); // Halfway to rim
  const visualHole = translate([visualHoleDist, 0, 0], cylinder({ radius: visualHoleR, height: THICKNESS * 2 }));
  // @ts-ignore
  gear = subtract(gear, visualHole);
  
  // Center it in Z
  gear = translate([0, 0, -THICKNESS / 2], gear);
  
  // Add Axle on one side (+Z)
  // Radius: Slightly larger than hole? Let's say 0.25 (Gear is ~3.0 dia).
  // Height: Stick out 0.6.
  const axleRadius = 0.2;
  const axleHeight = 0.6;
  let axle = cylinder({ radius: axleRadius, height: axleHeight });
  // Axle is centered at 0,0,0 (extending -H/2 to +H/2).
  // We want it starting at Z = THICKNESS/2.
  // Move it up by (THICKNESS/2 + Height/2).
  axle = translate([0, 0, THICKNESS / 2 + axleHeight / 2], axle);
  
  // @ts-ignore
  gear = union(gear, axle);
  
  return gear;
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
  
  const gearPitchRadius = (CONFIG.GEARS.COUNT * CONFIG.GEARS.MODULE) / 2;
  const gearOuterRadius = gearPitchRadius + CONFIG.GEARS.MODULE;
  const offset = (CONFIG.RAIL.HEAD_WIDTH / 2) + gearPitchRadius;
  
  // Calculate Gear Radial Center (X) relative to origin
  const headCenterR = radius + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS / 2;
  
  // Cutter Dimensions
  // Thickness (X): Reduced clearance. Gear Thick + 0.1.
  const slitThickness = CONFIG.GEARS.THICKNESS + 0.1; 
  // Face (Y/Z): Outer Diameter + Reduced Clearance (0.3).
  const slitFaceSize = (gearOuterRadius * 2) + 0.3; 
  
  // @ts-ignore
  const slitCutters: any[] = [];
  const corners = [-1, 1];
  
  [radius, -radius].forEach(xBase => {
      const xSign = Math.sign(xBase);
      corners.forEach(ySign => {
          corners.forEach(zSign => {
               // Gear Center
               const y = ySign * offset;
               const z = zSign * offset;
               
               // Accurate X Position
               const xSq = headCenterR*headCenterR - y*y;
               const x = (xSq > 0) ? xSign * Math.sqrt(xSq) : xSign * headCenterR;
               
               // Cutter size
               const cutter = cuboid({ size: [slitThickness, slitFaceSize, slitFaceSize] });
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
  const baseGear = createGear();
  // @ts-ignore
  const gears: any[] = [];
  
  // Double teeth (12 -> 24) for bigger size
  const gearPitchRadius = (24 * GEARS.MODULE) / 2;
  const offset = (CONFIG.RAIL.HEAD_WIDTH / 2) + gearPitchRadius;
  
  // Tangent Adjustment?
  // Curved Rails. At offset Y, X is not exactly Radius.
  // x = sqrt(R^2 - y^2).
  const headCenterR = RADIUS + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS / 2;
  
  const corners = [-1, 1];
  
  [RADIUS, -RADIUS].forEach(xBase => {
    const xSign = Math.sign(xBase);
    
    corners.forEach(ySign => {
      corners.forEach(zSign => {
          // Enable ALL 4 Quadrants as requested
          
          // Gear Center in YZ plane of intersection
          const yLocal = ySign * offset;
          const zLocal = zSign * offset;
          
          // Radial Position X
          // We need X such that the gear touches the rail at the correct point.
          // Yin Rail contact: (x, yLocal, z_contact_Yin). z_contact_Yin = +/- width/2.
          // Wait, Gear Z center is zLocal. Contact Z is zLocal - r (towards center).
          // If zSign is +, zLocal > 0. Contact at zLocal - r = width/2. Correct.
          // So contact point is at (x, yLocal, z_contact).
          // We need (x^2 + yLocal^2) = R_rail^2 for Yin Rail?
          // Yin Rail is circle in XY.
          // So x = +/- sqrt(R^2 - yLocal^2).
          
          let xSq = headCenterR*headCenterR - yLocal*yLocal;
          let x = (xSq > 0) ? xSign * Math.sqrt(xSq) : xSign * headCenterR;
          
          // Check Yang Rail contact?
          // Yang Rail in XZ.
          // x = +/- sqrt(R^2 - zLocal^2).
          // Is x the same?
          // yLocal = +/- Offset. zLocal = +/- Offset.
          // So magnitudes are same. So X is consistent!
          // Perfect. The intersection geometry supports this valid X.
          
          // Rotation
          // Axis is Radial Vector (x, yLocal, zLocal)?
          // No. Gear is in YZ plane (tangent plane Approx).
          // Axis should be Normal to the YZ plane... i.e., X Axis (Radial).
          // But since we are at (y, z), Radial vector is (x, y, z).
          // Ideally Gear Axis aligns with Radial Vector.
          // Rotate BaseZ to (x, y, z).
          
          // Base Gear Axis Z.
          // 1. Rotate Y 90 -> Base X.
          // 2. LookAt?
          
          // Simpler: Rotate Y 90 -> X Axis.
          // Then rotate around Z by atan2(y, x). (Yaw)
          // Then rotate around Y by atan2(z, x)? (Pitch)
          // Actually, use lookAt or Matrix.
          
          // We'll trust the "Radial Axis" logic implies roughly Pointing Outward.
          // Since y/x is small, and z/x is small.
          // Approx X axis.
          
          let g = rotateY(Math.PI / 2, baseGear); // Axis X
          
          // Adjust for Y/Z position angle?
          // The frame rotates.
          // Let's leave it axis-aligned to X for now (Standard "Corner" visualization).
          // With offset, visually it works.
          
          g = translate([x, yLocal, zLocal], g);
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
