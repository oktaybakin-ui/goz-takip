# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2024-02-22

### Added
- Advanced eye tracking features:
  - Kalman Filter for optimal gaze smoothing
  - Multi-Model Ensemble (3 models) for robust predictions
  - Advanced Iris Detection with RANSAC and ellipse fitting
  - Auto-Recalibration system for continuous improvement
- Memory pool pattern for efficient array management
- Web Worker support for heavy calculations
- CSS optimizations with critters and cssnano
- Custom Tailwind utilities and component styles
- RequestIdleCallback for background tasks

### Changed
- Calibration grid reduced from 7x7 (49 points) to 5x5 (25 points) for faster calibration
- Reduced calibration requirements: 40 → 30 samples per point
- Frame throttling optimized: adaptive 20-30fps based on processing time
- UI update rate: 80ms → 100ms
- Debug logging reduced from every 60 to 300 frames

### Fixed
- TypeScript compilation errors in worker files
- Vercel deployment ignoring gh-pages branch
- CSS optimization build errors
- Map iteration issues for older TypeScript targets
- Component ref type mismatches

### Performance
- Prediction caching for 16ms
- Canvas rendering frame skip optimization
- Next.js build optimizations with SWC
- Batch processing for features

## [0.1.0] - 2024-02-20

### Added
- Initial release
- MediaPipe FaceMesh integration
- Polynomial regression gaze model
- 25+5 point calibration system
- Multi-image support (1-10 images)
- Fixation detection with I-VT algorithm
- Heatmap generation
- Turkish/English language support
- Face cropping feature
- JSON/PNG export capabilities