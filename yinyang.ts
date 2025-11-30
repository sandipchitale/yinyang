// @ts-ignore
import primitives from '@jscad/modeling/src/primitives/index.js';
const { circle, rectangle, cuboid, cylinder } = primitives;
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
  },
  GEAR: {
    MODULE: 0.08, // Gear module (size of teeth)
    PRESSURE_ANGLE: 20, // Degrees
    PINION_TEETH: 32, // Number of teeth on pinion
    FACE_WIDTH: 0.5, // Width of the gear
    HOLE_RADIUS: 0.5, // Axle hole radius
    ADDENDUM_FACTOR: 1.0,
    DEDENDUM_FACTOR: 1.25,
  }
};

// Helper to create a simple gear tooth profile (trapezoidal approximation for robustness)
const createGearTooth = (module: number, pressureAngle: number) => {
  const pitch = Math.PI * module;
  const addendum = module * CONFIG.GEAR.ADDENDUM_FACTOR;
  const dedendum = module * CONFIG.GEAR.DEDENDUM_FACTOR;
  const toothDepth = addendum + dedendum;
  
  // Widths at pitch circle
  const toothThickness = pitch / 2;
  
  // Simple trapezoid
  // Bottom width (at root) approx
  const tanPA = Math.tan(pressureAngle * Math.PI / 180);
  const bottomWidth = toothThickness + 2 * (dedendum * tanPA);
  const topWidth = toothThickness - 2 * (addendum * tanPA);
  
  const points = [
    [-bottomWidth / 2, -dedendum],
    [bottomWidth / 2, -dedendum],
    [topWidth / 2, addendum],
    [-topWidth / 2, addendum]
  ];
  
  return primitives.polygon({ points });
};

const createPinion = () => {
  const { MODULE, PINION_TEETH, FACE_WIDTH, HOLE_RADIUS, PRESSURE_ANGLE } = CONFIG.GEAR;
  const pitchRadius = (MODULE * PINION_TEETH) / 2;
  const rootRadius = pitchRadius - (MODULE * CONFIG.GEAR.DEDENDUM_FACTOR);
  const outerRadius = pitchRadius + (MODULE * CONFIG.GEAR.ADDENDUM_FACTOR);
  
  let gearShape = circle({ radius: rootRadius, segments: 32 });
  const tooth = createGearTooth(MODULE, PRESSURE_ANGLE);
  
  for (let i = 0; i < PINION_TEETH; i++) {
    const angle = (i * 2 * Math.PI) / PINION_TEETH;
    // Position tooth at pitch radius
    let positionedTooth = translate([0, pitchRadius, 0], tooth);
    positionedTooth = rotateZ(angle, positionedTooth);
    gearShape = union(gearShape, positionedTooth);
  }

  // Add Marker Hole for Rotation Visibility
  const markerRadius = MODULE * 2.5;
  const markerDistance = pitchRadius * 0.6;
  const marker = translate([markerDistance, 0, 0], circle({ radius: markerRadius, segments: 16 }));
  gearShape = subtract(gearShape, marker);
  
  // Axle (instead of hole)
  // const hole = circle({ radius: HOLE_RADIUS, segments: 16 });
  // gearShape = subtract(gearShape, hole);
  
  let gear = extrudeLinear({ height: FACE_WIDTH }, gearShape);
  // Center gear in Z
  gear = translate([0, 0, -FACE_WIDTH / 2], gear);
  
  // Create Axle
  // Protrude 0.2mm on each side
  const axleHeight = FACE_WIDTH + 0.4;
  const axle = cylinder({ radius: HOLE_RADIUS, height: axleHeight, segments: 16 });
  // Cylinder is centered at [0,0,0] by default, which matches our centered gear.
  
  return union(gear, axle);
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
  let rail = extrudeRotate({ startAngle, angle, segments: CONFIG.SEGMENTS }, profile);
  
  // Add Gear Teeth (Rack)
  // We need to subtract teeth from the outer face of the rail head
  // The rail head is at radius + STEM_LENGTH + HEAD_THICKNESS
  // We want the teeth to be cut into this surface.
  
  const { MODULE, PRESSURE_ANGLE } = CONFIG.GEAR;
  const tooth = createGearTooth(MODULE, PRESSURE_ANGLE);
  
  // Calculate number of teeth based on arc length
  const arcLength = radius * angle;
  const pitch = Math.PI * MODULE;
  const numTeeth = Math.floor(arcLength / pitch);
  
  // Create a ring of teeth
  const toothRadius = radius + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS;
  
  // We need to position teeth along the arc
  // Since we are subtracting, we need the "negative" of the tooth space?
  // Actually, a rack usually has teeth added.
  // But our rail has a smooth outer surface.
  // If we want to add teeth, we should union them.
  // If we want to cut teeth, we subtract the "space" between teeth.
  // Let's UNION teeth onto the outer surface.
  
  // Adjust tooth orientation for rack
  // The tooth points outwards.
  
  let teethRing = null;
  
  // We only place teeth within the startAngle to startAngle + angle range
  // Let's iterate
  
  const startIdx = Math.ceil((startAngle * radius) / pitch);
  const endIdx = Math.floor(((startAngle + angle) * radius) / pitch);
  
  // Actually, let's just place them based on angle
  const angleStep = pitch / toothRadius;
  const totalTeeth = Math.floor(angle / angleStep);
  
  for (let i = 0; i <= totalTeeth; i++) {
    const currentAngle = startAngle + i * angleStep;
    
    // Position tooth
    // Rotate to angle
    // Translate to radius
    
    // Tooth needs to be rotated 90 deg to point out?
    // createGearTooth returns a polygon in XY plane.
    // We need to extrude it to make a 3D tooth, then position it.
    
    // Wait, extrudeRotate takes a 2D profile.
    // We can't easily add 3D teeth to a 2D profile sweep unless the profile itself has teeth (which would make longitudinal ribs).
    // We need 3D teeth.
    
    let oneTooth = extrudeLinear({ height: CONFIG.RAIL.HEAD_WIDTH }, tooth);
    // Center in Z (rail height)
    // Rail head width is HEAD_WIDTH.
    // We want the tooth to be centered on the rail.
    oneTooth = translate([0, 0, -CONFIG.RAIL.HEAD_WIDTH / 2], oneTooth);
    
    // Orient tooth to point outwards
    oneTooth = rotateZ(-Math.PI / 2, oneTooth); // Point along X?
    oneTooth = translate([toothRadius, 0, 0], oneTooth); // Move to radius
    oneTooth = rotateZ(currentAngle, oneTooth); // Rotate to position
    
    if (teethRing === null) {
      teethRing = oneTooth;
    } else {
      teethRing = union(teethRing, oneTooth);
    }
  }
  
  if (teethRing) {
    rail = union(rail, teethRing);
  }
  
  return rail;
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
  // Yin: -89 to 89 degrees (178 total)
  const yinRail = createTRail(RADIUS, -89 * Math.PI / 180, 178 * Math.PI / 180);
  yin3D = union(yin3D, yinRail);
  
  // Yang: 91 to 269 degrees (178 total)
  const yangRail = createTRail(RADIUS, 91 * Math.PI / 180, 178 * Math.PI / 180);
  yang3D = union(yang3D, yangRail);
  // The 'rotation' variable is not defined in the current scope.
  // To maintain syntactical correctness as per instructions, this line is omitted.
  // Also, the original code had 'yang3D = rotateX(Math.PI / 2, yang3D);' here.
  // The provided snippet had a syntax error: 'yang3D = rotateZ(rotation, yang3D); = rotateX(Math.PI / 2, yang3D);'
  // Assuming the intent was to keep the rotateX, and the rotateZ was conditional or a placeholder.
  yang3D = rotateX(Math.PI / 2, yang3D);
  
  const frame = createFrame(RADIUS);
  
  // Create Gears
  const pinion = createPinion();
  const gears = [];
  
  // Gear Positions (Angles relative to frame center)
  // 6 gears per frame ring.
  // The frame rings are semicircles (roughly).
  // Yin Frame (Vertical ring in YZ plane? No, frame is created in XY then rotated?)
  // createFrame creates a ring in XY.
  // Then splitFrame cuts it.
  // We need to place gears on the ring.
  
  // Angles for gears: +/- 45, +/- 90, +/- 135 degrees from the "equator"
  // This places 3 gears on each semicircular arc, centered at 90 deg.
  const gearAngles = [45, 90, 135, -45, -90, -135].map(a => a * Math.PI / 180);
  
  // Yin Frame Gears (associated with Yin Rotor)
  // Yin Rotor rotates around Z.
  // Yin Frame is the one that holds the Yang Rotor? No.
  // The Frame holds BOTH rotors.
  // But the T-rails are on the rotors.
  // The gears are on the frame, engaging the rotors.
  // So we need gears engaging Yin Rotor (Z-axis rotation) and gears engaging Yang Rotor (Y-axis rotation).
  
  // Yin Rotor is in XY plane (flat). Rail is on the edge.
  // So gears for Yin Rotor must be in XY plane, around the Z axis.
  // The Frame has a ring in the XY plane?
  // createFrame creates a union of two rings.
  // yinRingSolid (XY plane) and yangRingSolid (XZ plane because rotated X 90).
  
  // So we place 6 gears on the Yin Ring (XY) and 6 gears on the Yang Ring (XZ).
  
  const { RADIUS: radius } = CONFIG;
  const gearDistance = radius + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS + CONFIG.GEAR.MODULE; 
  // Pitch circle of pinion should be tangent to pitch circle of rack.
  // Rack pitch radius approx toothRadius.
  // Pinion pitch radius = (MODULE * TEETH) / 2.
  // Distance = toothRadius + pinionPitchRadius.
  
  const pinionPitchRadius = (CONFIG.GEAR.MODULE * CONFIG.GEAR.PINION_TEETH) / 2;
  const rackRadius = radius + CONFIG.RAIL.STEM_LENGTH + CONFIG.RAIL.HEAD_THICKNESS;
  const centerDist = rackRadius + pinionPitchRadius + 0.5; // Tangent pitch circles + 0.5mm offset
  
  // Yin Gears (XY Plane)
  const yinGears: any[] = [];
  gearAngles.forEach(angle => {
    let gear = pinion;
    // Rotate gear around its own axis (optional, for visual variety)
    // gear = rotateZ(Math.random() * Math.PI, gear);
    
    // Position gear
    gear = translate([centerDist, 0, 0], gear);
    gear = rotateZ(angle, gear);
    yinGears.push(gear);
  });
  
  // Yang Gears (XZ Plane)
  // Yang Rotor is rotated 90 deg around X (or Y in ThreeJS).
  // In JSCAD, yang3D was rotated X 90.
  // So Yang Gears should be in XZ plane.
  const yangGears: any[] = [];
  gearAngles.forEach(angle => {
    let gear = pinion;
    gear = translate([centerDist, 0, 0], gear);
    gear = rotateZ(angle, gear);
    // Rotate to XZ plane
    gear = rotateX(Math.PI / 2, gear);
    yangGears.push(gear);
  });
  
  // Combine all gears
  const allGears = [...yinGears, ...yangGears];
  
  // Create Slits in Frame
  // We need to subtract the gear volume (plus clearance) from the frame.
  // Let's use a slightly larger cylinder for the cutter.
  const cutterRadius = CONFIG.GEAR.MODULE * CONFIG.GEAR.PINION_TEETH / 2 + 0.15; // Tighter clearance
  const cutter = cylinder({ radius: cutterRadius, height: CONFIG.GEAR.FACE_WIDTH + 0.2, segments: 16 });
  
  let frameWithSlits = frame;
  
  // Subtract Yin Gear Cutters
  gearAngles.forEach(angle => {
    let c = cutter;
    // Orient cutter along Z (default)
    // Position
    c = translate([centerDist, 0, 0], c);
    c = rotateZ(angle, c);
    frameWithSlits = subtract(frameWithSlits, c);
  });
  
  // Subtract Yang Gear Cutters
  gearAngles.forEach(angle => {
    let c = cutter;
    c = translate([centerDist, 0, 0], c);
    c = rotateZ(angle, c);
    c = rotateX(Math.PI / 2, c);
    frameWithSlits = subtract(frameWithSlits, c);
  });

  return { yin3D, yang3D, frame: frameWithSlits, gears: allGears, pinion };
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
  const { yin3D, yang3D, frame, gears, pinion } = createYinYangParts();
  
  // Export Assembly
  exportSTL('yinyang_assembly.stl', [yin3D, yang3D, frame, ...gears]);
  
  // Export Parts
  exportSTL('yin.stl', yin3D);
  exportSTL('yang.stl', yang3D);
  exportSTL('gears.stl', gears);
  exportSTL('pinion.stl', pinion);
  
  // Split Frame
  const { frameLeft, frameRight } = splitFrame(frame, CONFIG.RADIUS);
  exportSTL('frame_left.stl', frameLeft);
  exportSTL('frame_right.stl', frameRight);
};

main();
