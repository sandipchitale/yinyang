# YinYang 3D Printable Model

This project generates a 3D printable Yin Yang gimbal mechanism using TypeScript and [JSCAD](https://openjscad.xyz/). It includes a T-rail mechanism for smooth rotation and a split frame for easy assembly.

## Project Structure

- `yinyang.ts`: The main source code defining the geometry.
- `index.html` & `viewer.js`: A web-based 3D viewer to preview the generated STL files.
- `package.json`: Dependencies and scripts.

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- npm

### Installation

```bash
npm install
```

## Generating STL Files

To generate the STL files for 3D printing, run:

```bash
npm run generate
```

This will create the following files in the project directory:

- `yin.stl`: The Yin rotor (white).
- `yang.stl`: The Yang rotor (black).
- `frame_left.stl`: The left half of the frame.
- `frame_right.stl`: The right half of the frame.
- `yinyang_assembly.stl`: The complete assembly (for reference).

## Viewing the Model

To preview the generated models in an interactive 3D viewer:

```bash
f3d --up=+Z --grid-absolute yinyang_assembly.stl
```

## 3D Printing Guide

### Recommended Settings

- **Material**: PLA or PETG.
- **Layer Height**: 0.16mm or 0.2mm.
- **Infill**: 15-20%.
- **Supports**:
  - **Rotors (Yin/Yang)**: Print flat on the bed. Supports may be needed for the T-rail overhangs depending on your printer's bridging capability.
  - **Frame**: Print the split halves flat on the cut face. No supports should be needed for the frame halves if oriented correctly.
- **Tolerance**: The model is designed with a 0.3mm - 0.4mm clearance. If parts are too tight, try reducing flow slightly or scaling the rotors down by 1-2% in X/Y (but keep Z same).

### Assembly

1.  Insert the Yin rotor into the frame groove.
2.  Insert the Yang rotor into the frame groove, perpendicular to Yin.
3.  Snap or glue the two frame halves together, trapping the rotors inside.
4.  Ensure both rotors spin freely. Apply a small amount of lubricant (silicone grease) to the tracks if needed.
