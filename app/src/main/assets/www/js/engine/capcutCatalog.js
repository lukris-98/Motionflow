export const ANIMATION_CATALOG = [
  // TEXT-SPECIFIC IN Animations
  { id: 'textPopBounce', cat: 'in', target: 'text', label: 'Pop Teks', animClass: 'mf-anim-bounce-in', color: '#38bdf8' },
  { id: 'textSlideUpFade', cat: 'in', target: 'text', label: 'Muncul Bawah', animClass: 'mf-anim-slide-up', color: '#69f0ae' },
  { id: 'textSlideLeftIn', cat: 'in', target: 'text', label: 'Masuk Kiri', animClass: 'mf-anim-slide-left', color: '#40c4ff' },
  { id: 'textSlideRightIn', cat: 'in', target: 'text', label: 'Masuk Kanan', animClass: 'mf-anim-slide-right', color: '#22d3ee' },
  { id: 'textZoomFocus', cat: 'in', target: 'text', label: 'Fokus Teks', animClass: 'mf-anim-zoom-in', color: '#ffab40' },
  { id: 'textTypeReveal', cat: 'in', target: 'text', label: 'Kilap Masuk', animClass: 'mf-anim-fade-in', color: '#a78bfa' },
  { id: 'textDropBounce', cat: 'in', target: 'text', label: 'Jatuh Mantul', animClass: 'mf-anim-drop-bounce', color: '#f472b6' },
  { id: 'textFlipUp3D', cat: 'in', target: 'text', label: 'Lipat 3D', animClass: 'mf-anim-flip-up', color: '#7c4dff' },
  { id: 'textElasticPop', cat: 'in', target: 'text', label: 'Elastis Pop', animClass: 'mf-anim-elastic-pop', color: '#ffd740' },

  // TEXT-SPECIFIC OUT Animations
  { id: 'textFadeDown', cat: 'out', target: 'text', label: 'Turun Pudar', animClass: 'mf-anim-slide-out-d', color: '#69f0ae' },
  { id: 'textFadeUpOut', cat: 'out', target: 'text', label: 'Naik Pudar', animClass: 'mf-anim-slide-out-u', color: '#38bdf8' },
  { id: 'textSlideLeftOut', cat: 'out', target: 'text', label: 'Geser Kiri', animClass: 'mf-anim-slide-out-l', color: '#40c4ff' },
  { id: 'textSlideRightOut', cat: 'out', target: 'text', label: 'Geser Kanan', animClass: 'mf-anim-slide-out-r', color: '#22d3ee' },
  { id: 'textZoomFadeOut', cat: 'out', target: 'text', label: 'Kecil Pudar', animClass: 'mf-anim-zoom-out', color: '#ffab40' },
  { id: 'textZoomBurstOut', cat: 'out', target: 'text', label: 'Ledak Zoom', animClass: 'mf-anim-zoom-burst-out', color: '#fb7185' },
  { id: 'textFlipDown3D', cat: 'out', target: 'text', label: 'Lipat 3D Out', animClass: 'mf-anim-flip-down', color: '#7c4dff' },
  { id: 'textShrinkSpinOut', cat: 'out', target: 'text', label: 'Putar Kecil', animClass: 'mf-anim-spin-out', color: '#b388ff' },

  // TEXT-SPECIFIC COMBO Animations
  { id: 'textPulseGlow', cat: 'combo', target: 'text', label: 'Denyut Teks', animClass: 'mf-anim-pulse', color: '#38bdf8' },
  { id: 'textWaveFloat', cat: 'combo', target: 'text', label: 'Ayun Teks', animClass: 'mf-anim-swing', color: '#f472b6' },
  { id: 'textWiggle', cat: 'combo', target: 'text', label: 'Getar Teks', animClass: 'mf-anim-shake', color: '#ff5252' },
  { id: 'textFloatBob', cat: 'combo', target: 'text', label: 'Melayang', animClass: 'mf-anim-float-bob', color: '#34d399' },
  { id: 'textFlipCard3D', cat: 'combo', target: 'text', label: 'Ayun 3D', animClass: 'mf-anim-float3d', color: '#a78bfa' },

  // SHARED / VIDEO & IMAGE ITEM IN Animations
  { id: 'fadeIn', cat: 'in', target: 'all', label: 'Fade In', animClass: 'mf-anim-fade-in', color: '#00e5ff' },
  { id: 'slideInLeft', cat: 'in', target: 'all', label: 'Slide Left', animClass: 'mf-anim-slide-left', color: '#40c4ff' },
  { id: 'slideInRight', cat: 'in', target: 'all', label: 'Slide Right', animClass: 'mf-anim-slide-right', color: '#40c4ff' },
  { id: 'slideInUp', cat: 'in', target: 'visual', label: 'Slide Up', animClass: 'mf-anim-slide-up', color: '#69f0ae' },
  { id: 'slideInDown', cat: 'in', target: 'all', label: 'Slide Down', animClass: 'mf-anim-slide-down', color: '#69f0ae' },
  { id: 'diagSlideIn', cat: 'in', target: 'visual', label: 'Geser Serong', animClass: 'mf-anim-diag-in', color: '#2dd4bf' },
  { id: 'zoomIn', cat: 'in', target: 'visual', label: 'Zoom In', animClass: 'mf-anim-zoom-in', color: '#ffab40' },
  { id: 'zoomCrashIn', cat: 'in', target: 'visual', label: 'Zoom Hantam', animClass: 'mf-anim-zoom-crash-in', color: '#fb7185' },
  { id: 'bounceIn', cat: 'in', target: 'visual', label: 'Bounce In', animClass: 'mf-anim-bounce-in', color: '#ff4081' },
  { id: 'rubberIn', cat: 'in', target: 'visual', label: 'Karet Kenyal', animClass: 'mf-anim-rubber-in', color: '#f59e0b' },
  { id: 'spinIn', cat: 'in', target: 'all', label: 'Spin In', animClass: 'mf-anim-spin-in', color: '#b388ff' },
  { id: 'tilt3DIn', cat: 'in', target: 'visual', label: 'Flip 3D In', animClass: 'mf-anim-flip-y-in', color: '#7c4dff' },
  { id: 'swingIn', cat: 'in', target: 'visual', label: 'Ayun Masuk', animClass: 'mf-anim-swing-in', color: '#38bdf8' },
  { id: 'popUp', cat: 'in', target: 'all', label: 'Pop Up', animClass: 'mf-anim-pop-up', color: '#ffd740' },

  // SHARED / VIDEO & IMAGE ITEM OUT Animations
  { id: 'fadeOut', cat: 'out', target: 'all', label: 'Fade Out', animClass: 'mf-anim-fade-out', color: '#00e5ff' },
  { id: 'slideOutLeft', cat: 'out', target: 'all', label: 'Slide Out L', animClass: 'mf-anim-slide-out-l', color: '#40c4ff' },
  { id: 'slideOutRight', cat: 'out', target: 'all', label: 'Slide Out R', animClass: 'mf-anim-slide-out-r', color: '#40c4ff' },
  { id: 'slideOutUp', cat: 'out', target: 'visual', label: 'Slide Up Out', animClass: 'mf-anim-slide-out-u', color: '#38bdf8' },
  { id: 'slideOutDown', cat: 'out', target: 'visual', label: 'Drop Out', animClass: 'mf-anim-slide-out-d', color: '#69f0ae' },
  { id: 'zoomOut', cat: 'out', target: 'visual', label: 'Zoom Out', animClass: 'mf-anim-zoom-out', color: '#ffab40' },
  { id: 'zoomCrashOut', cat: 'out', target: 'visual', label: 'Zoom Keluar', animClass: 'mf-anim-zoom-burst-out', color: '#fb7185' },
  { id: 'shrinkBounceOut', cat: 'out', target: 'visual', label: 'Kecil Mantul', animClass: 'mf-anim-shrink-bounce-out', color: '#f472b6' },
  { id: 'spinOut', cat: 'out', target: 'all', label: 'Spin Out', animClass: 'mf-anim-spin-out', color: '#b388ff' },
  { id: 'tilt3DOut', cat: 'out', target: 'visual', label: 'Flip 3D Out', animClass: 'mf-anim-flip-y-out', color: '#7c4dff' },
  { id: 'swingOut', cat: 'out', target: 'visual', label: 'Ayun Keluar', animClass: 'mf-anim-swing-out', color: '#22d3ee' },

  // SHARED / VIDEO & IMAGE ITEM COMBO / LOOP Animations
  { id: 'bounce', cat: 'combo', target: 'all', label: 'Bounce Pop', animClass: 'mf-anim-bounce', color: '#ff4081' },
  { id: 'shake', cat: 'combo', target: 'visual', label: 'Camera Shake', animClass: 'mf-anim-shake', color: '#ff5252' },
  { id: 'pulseLoop', cat: 'combo', target: 'visual', label: 'Heartbeat', animClass: 'mf-anim-pulse', color: '#00e5ff' },
  { id: 'swing', cat: 'combo', target: 'visual', label: 'Pendulum', animClass: 'mf-anim-swing', color: '#ffab40' },
  { id: 'kenBurnsZoom', cat: 'combo', target: 'visual', label: 'Ken Burns', animClass: 'mf-anim-ken-burns', color: '#34d399' },
  { id: 'swayFloat', cat: 'combo', target: 'visual', label: 'Goyang Halus', animClass: 'mf-anim-float-bob', color: '#38bdf8' },
  { id: 'bounceFallLoop', cat: 'combo', target: 'visual', label: 'Lompat Beat', animClass: 'mf-anim-bounce-loop', color: '#f59e0b' },
  { id: 'float3D', cat: 'combo', target: 'all', label: '3D Float', animClass: 'mf-anim-float3d', color: '#7c4dff' },
  { id: 'rotate360', cat: 'combo', target: 'all', label: 'Spin 360°', animClass: 'mf-anim-spin-360', color: '#69f0ae' }
];

export function getAnimationCatalogForLayerType(layerType, category = null) {
  const isText = layerType === 'text';
  return ANIMATION_CATALOG.filter((item) => {
    if (category && item.cat !== category) return false;
    if (isText) return item.target === 'text' || item.target === 'all';
    return item.target !== 'text';
  });
}


export const TEXT_TEMPLATES = [
  {
    id: 'neonTitle',
    label: 'Cyber Neon',
    sample: 'NEON',
    textProps: {
      text: 'CYBER NEON',
      fontFamily: 'sans-serif',
      fontSize: 78,
      fontWeight: '900',
      color: '#FFFFFF',
      gradientEnabled: false,
      strokeColor: '#00E5FF',
      strokeWidth: 4,
      shadowColor: '#00E5FF',
      shadowBlur: 24,
      shadowOffsetY: 0,
      bgEnabled: false,
      letterSpacing: 3,
      curve: 0
    },
    presetIn: 'zoomIn'
  },
  {
    id: 'sunsetGrad',
    label: 'Sunset Grad',
    sample: 'GLOW',
    textProps: {
      text: 'SUMMER VIBES',
      fontFamily: 'sans-serif',
      fontSize: 74,
      fontWeight: '900',
      color: '#FFEB3B',
      gradientEnabled: true,
      gradientColor2: '#FF4081',
      strokeColor: '#1A0B2E',
      strokeWidth: 5,
      shadowColor: 'rgba(255,64,129,0.65)',
      shadowBlur: 18,
      bgEnabled: false,
      letterSpacing: 2,
      curve: 0
    },
    presetIn: 'popUp'
  },
  {
    id: 'breakingNews',
    label: 'Breaking Tag',
    sample: 'LIVE',
    textProps: {
      text: 'BREAKING NEWS',
      fontFamily: 'sans-serif',
      fontSize: 54,
      fontWeight: '900',
      color: '#FFFFFF',
      gradientEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowBlur: 6,
      bgEnabled: true,
      bgColor: '#E53935',
      bgOpacity: 0.96,
      bgRadius: 10,
      bgPadding: 18,
      letterSpacing: 1,
      curve: 0
    },
    presetIn: 'slideInLeft'
  },
  {
    id: 'vlogTag',
    label: 'Vlog Yellow',
    sample: 'VLOG',
    textProps: {
      text: 'DAILY VLOG #01',
      fontFamily: 'sans-serif',
      fontSize: 58,
      fontWeight: '800',
      color: '#11151E',
      gradientEnabled: false,
      strokeColor: '#FFFFFF',
      strokeWidth: 0,
      shadowBlur: 0,
      bgEnabled: true,
      bgColor: '#FFD740',
      bgOpacity: 1,
      bgRadius: 24,
      bgPadding: 20,
      letterSpacing: 0,
      curve: 0
    },
    presetIn: 'bounceIn'
  },
  {
    id: 'minimalSub',
    label: 'Clean Sub',
    sample: 'Subtitle',
    textProps: {
      text: 'Clean cinematic subtitle',
      fontFamily: 'sans-serif',
      fontSize: 44,
      fontWeight: '700',
      color: '#FFFFFF',
      gradientEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 3,
      shadowColor: 'rgba(0,0,0,0.85)',
      shadowBlur: 10,
      shadowOffsetY: 3,
      bgEnabled: true,
      bgColor: '#05070B',
      bgOpacity: 0.62,
      bgRadius: 12,
      bgPadding: 14,
      letterSpacing: 0,
      curve: 0
    },
    presetIn: 'fadeIn'
  },
  {
    id: 'boldPop',
    label: 'Comic Pop',
    sample: 'BOOM!',
    textProps: {
      text: 'WOW MOMENT!',
      fontFamily: 'sans-serif',
      fontSize: 72,
      fontWeight: '900',
      color: '#FFEB3B',
      gradientEnabled: false,
      strokeColor: '#1A0B2E',
      strokeWidth: 10,
      shadowColor: '#FF4081',
      shadowBlur: 14,
      shadowOffsetY: 6,
      bgEnabled: false,
      letterSpacing: 2,
      curve: 18
    },
    presetIn: 'popUp'
  },
  {
    id: 'cinemaSerif',
    label: 'Cinema Serif',
    sample: 'Title',
    textProps: {
      text: 'A SHORT FILM',
      fontFamily: 'serif',
      fontSize: 64,
      fontWeight: '700',
      color: '#F5EFE6',
      gradientEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowBlur: 16,
      shadowOffsetY: 4,
      bgEnabled: false,
      letterSpacing: 6,
      curve: 0
    },
    presetIn: 'fadeIn'
  },
  {
    id: 'quoteBubble',
    label: 'Glass Pill',
    sample: 'Note',
    textProps: {
      text: 'Highlight Point',
      fontFamily: 'sans-serif',
      fontSize: 50,
      fontWeight: '700',
      color: '#00E5FF',
      gradientEnabled: false,
      strokeWidth: 0,
      shadowBlur: 8,
      bgEnabled: true,
      bgColor: '#131C2E',
      bgOpacity: 0.88,
      bgRadius: 32,
      bgPadding: 22,
      letterSpacing: 0,
      curve: 0
    },
    presetIn: 'slideInUp'
  },
  {
    id: 'retroGold',
    label: 'Luxury Gold',
    sample: 'GOLD',
    textProps: {
      text: 'LIMITED EDITION',
      fontFamily: 'serif',
      fontSize: 60,
      fontWeight: '900',
      color: '#FFF8E1',
      gradientEnabled: true,
      gradientColor2: '#FFB300',
      strokeColor: '#5D4037',
      strokeWidth: 4,
      shadowColor: 'rgba(255, 193, 7, 0.65)',
      shadowBlur: 18,
      shadowOffsetY: 3,
      bgEnabled: false,
      letterSpacing: 2,
      curve: 0
    },
    presetIn: 'zoomIn'
  },
  {
    id: 'arcBadge',
    label: 'Curved Arc',
    sample: 'ARC',
    textProps: {
      text: 'TOP TRENDING',
      fontFamily: 'sans-serif',
      fontSize: 62,
      fontWeight: '900',
      color: '#FFFFFF',
      gradientEnabled: true,
      gradientColor2: '#00E5FF',
      strokeColor: '#0B0E14',
      strokeWidth: 5,
      shadowBlur: 12,
      bgEnabled: false,
      letterSpacing: 2,
      curve: 36
    },
    presetIn: 'bounceIn'
  }
];

export const FILTER_PRESETS = [
  { id: 'normal', cat: 'all', label: 'Original', css: 'none', fx: { brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0, fade: 0, vignette: 0 } },
  { id: 'cinema', cat: 'cinema', label: 'Cinema', css: 'contrast(1.22) saturate(0.88) hue-rotate(-6deg)', fx: { brightness: -0.05, contrast: 1.24, saturation: 0.88, temperature: -0.14, tint: 0, exposure: 0, highlights: -0.1, shadows: 0.08, fade: 0.06, vignette: 0.45 } },
  { id: 'teal', cat: 'cinema', label: 'Teal & Orange', css: 'contrast(1.16) saturate(1.1) hue-rotate(-10deg)', fx: { brightness: 0, contrast: 1.16, saturation: 1.04, temperature: -0.34, tint: -0.08, exposure: 0, highlights: 0, shadows: 0.1, fade: 0, vignette: 0.28 } },
  { id: 'emerald', cat: 'cinema', label: 'Emerald Film', css: 'contrast(1.15) saturate(0.92) hue-rotate(10deg)', fx: { brightness: -0.02, contrast: 1.18, saturation: 0.92, temperature: -0.22, tint: -0.16, exposure: 0.02, highlights: -0.08, shadows: 0.12, fade: 0.1, vignette: 0.36 } },
  { id: 'warm', cat: 'warm', label: 'Warm Sunset', css: 'sepia(0.22) saturate(1.22) brightness(1.04)', fx: { brightness: 0.04, contrast: 1.08, saturation: 1.18, temperature: 0.36, tint: 0.06, exposure: 0.06, highlights: 0, shadows: 0.05, fade: 0, vignette: 0.16 } },
  { id: 'golden', cat: 'warm', label: 'Golden Hour', css: 'sepia(0.18) brightness(1.1) saturate(1.3)', fx: { brightness: 0.08, contrast: 1.06, saturation: 1.26, temperature: 0.44, tint: -0.04, exposure: 0.12, highlights: 0.1, shadows: 0.12, fade: 0.05, vignette: 0.12 } },
  { id: 'vivid', cat: 'warm', label: 'Vivid Pop', css: 'contrast(1.18) saturate(1.48) brightness(1.05)', fx: { brightness: 0.05, contrast: 1.18, saturation: 1.48, temperature: 0.08, tint: 0, exposure: 0.05, highlights: 0.05, shadows: 0.05, fade: 0, vignette: 0 } },
  { id: 'roseGold', cat: 'warm', label: 'Rose Peach', css: 'saturate(1.15) brightness(1.06) hue-rotate(-8deg)', fx: { brightness: 0.06, contrast: 1.04, saturation: 1.12, temperature: 0.2, tint: 0.24, exposure: 0.05, highlights: 0.08, shadows: 0.1, fade: 0.08, vignette: 0.1 } },
  { id: 'noir', cat: 'bw', label: 'Noir B&W', css: 'grayscale(1) contrast(1.42)', fx: { brightness: -0.04, contrast: 1.42, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0.05, shadows: -0.1, fade: 0.04, vignette: 0.58 } },
  { id: 'vintage', cat: 'bw', label: 'Vintage 90s', css: 'sepia(0.35) contrast(0.95) brightness(1.06)', fx: { brightness: 0.03, contrast: 0.94, saturation: 0.78, temperature: 0.24, tint: 0.08, exposure: 0, highlights: -0.15, shadows: 0.18, fade: 0.28, vignette: 0.35 } },
  { id: 'matte', cat: 'bw', label: 'Matte Film', css: 'contrast(0.88) brightness(1.06) saturate(0.85)', fx: { brightness: 0.04, contrast: 0.9, saturation: 0.85, temperature: -0.06, tint: 0.05, exposure: 0, highlights: -0.12, shadows: 0.2, fade: 0.36, vignette: 0.22 } },
  { id: 'portra', cat: 'bw', label: 'Kodak Film', css: 'contrast(1.05) saturate(1.12) sepia(0.1)', fx: { brightness: 0.03, contrast: 1.08, saturation: 1.1, temperature: 0.18, tint: 0.04, exposure: 0.04, highlights: -0.1, shadows: 0.14, fade: 0.16, vignette: 0.2 } },
  { id: 'cyberpunk', cat: 'neon', label: 'Cyber Neon', css: 'contrast(1.28) saturate(1.45) hue-rotate(18deg)', fx: { brightness: -0.02, contrast: 1.28, saturation: 1.42, temperature: -0.26, tint: 0.32, exposure: 0.04, highlights: 0.12, shadows: -0.06, fade: 0, vignette: 0.38 } },
  { id: 'coolIce', cat: 'neon', label: 'Arctic Blue', css: 'contrast(1.16) saturate(1.12) hue-rotate(165deg)', fx: { brightness: 0.02, contrast: 1.16, saturation: 1.06, temperature: -0.45, tint: 0.08, exposure: 0.02, highlights: 0.06, shadows: 0.04, fade: 0.06, vignette: 0.22 } }
];

export const VIDEO_EFFECT_PRESETS = [
  { id: 'none', cat: 'all', shaderId: 0, label: 'None', badge: 'OFF', css: 'none', accent: '#8b98b0' },
  { id: 'glitch', cat: 'trending', shaderId: 1, label: 'Glitch', badge: 'DIGITAL', css: 'contrast(1.3) hue-rotate(12deg)', accent: '#00e5ff' },
  { id: 'rgbSplit', cat: 'trending', shaderId: 2, label: 'RGB Split', badge: 'CHROMA', css: 'saturate(1.45) contrast(1.15)', accent: '#ff4081' },
  { id: 'shakeCam', cat: 'trending', shaderId: 4, label: 'Shake', badge: 'CAM', css: 'contrast(1.08)', accent: '#ff5252' },
  { id: 'flashPulse', cat: 'trending', shaderId: 5, label: 'Flash Pulse', badge: 'BEAT', css: 'brightness(1.35) contrast(1.18)', accent: '#ffd740' },
  { id: 'zoomBlur', cat: 'trending', shaderId: 13, label: 'Zoom Blur', badge: 'ACTION', css: 'contrast(1.15) saturate(1.2)', accent: '#00e5ff' },
  { id: 'mirrorGrid', cat: 'trending', shaderId: 10, label: 'Split Clone', badge: '2x2', css: 'contrast(1.12)', accent: '#69f0ae' },
  { id: 'strobeBlack', cat: 'trending', shaderId: 16, label: 'Black Flash', badge: 'STROBE', css: 'brightness(0.72) contrast(1.4)', accent: '#ffab40' },
  { id: 'vhsRetro', cat: 'retro', shaderId: 3, label: 'VHS Retro', badge: '90s', css: 'sepia(0.28) contrast(1.1)', accent: '#ffab40' },
  { id: 'filmGrain', cat: 'retro', shaderId: 6, label: 'Film Grain', badge: '35MM', css: 'contrast(1.12) saturate(0.9)', accent: '#d7ccc8' },
  { id: 'crtScan', cat: 'retro', shaderId: 14, label: 'CRT TV', badge: 'TUBE', css: 'contrast(1.22) saturate(1.15)', accent: '#40c4ff' },
  { id: 'halftone', cat: 'retro', shaderId: 15, label: 'Comic Dots', badge: 'POP', css: 'contrast(1.38) saturate(1.25)', accent: '#ffd740' },
  { id: 'nightVision', cat: 'lens', shaderId: 7, label: 'Night Vision', badge: 'NVG', css: 'hue-rotate(85deg) saturate(1.8) contrast(1.25)', accent: '#69f0ae' },
  { id: 'dreamGlow', cat: 'lens', shaderId: 8, label: 'Dream Glow', badge: 'BLOOM', css: 'blur(0.8px) brightness(1.16) saturate(1.2)', accent: '#b388ff' },
  { id: 'pixelate', cat: 'lens', shaderId: 9, label: 'Mosaic', badge: '8-BIT', css: 'contrast(1.1)', accent: '#ff8a65' },
  { id: 'edgeNeon', cat: 'lens', shaderId: 11, label: 'Neon Edge', badge: 'GLOW', css: 'invert(0.15) hue-rotate(180deg) contrast(1.5)', accent: '#00e5ff' },
  { id: 'fisheye', cat: 'lens', shaderId: 12, label: 'Fisheye', badge: '180°', css: 'contrast(1.1)', accent: '#7c4dff' }
];

export const MASK_PRESETS = [
  { id: 'none', shaderType: 0, label: 'None', icon: 'bi-slash-circle' },
  { id: 'split', shaderType: 3, label: 'Split', icon: 'bi-layout-split' },
  { id: 'filmstrip', shaderType: 4, label: 'Filmstrip', icon: 'bi-distribute-vertical' },
  { id: 'circle', shaderType: 2, label: 'Circle', icon: 'bi-circle' },
  { id: 'rect', shaderType: 1, label: 'Rectangle', icon: 'bi-square' },
  { id: 'heart', shaderType: 5, label: 'Heart', icon: 'bi-heart' },
  { id: 'star', shaderType: 6, label: 'Star', icon: 'bi-star' }
];

export const PIP_LAYOUT_PRESETS = [
  { id: 'full', label: 'Reset Full', x: 0, y: 0, scale: 1, crop: { left: 0, right: 0, top: 0, bottom: 0 } },
  { id: 'pipTR', label: 'PIP Top-R', xNorm: 0.28, yNorm: -0.28, scale: 0.38 },
  { id: 'pipBR', label: 'PIP Bot-R', xNorm: 0.28, yNorm: 0.28, scale: 0.38 },
  { id: 'pipTL', label: 'PIP Top-L', xNorm: -0.28, yNorm: -0.28, scale: 0.38 },
  { id: 'pipBL', label: 'PIP Bot-L', xNorm: -0.28, yNorm: 0.28, scale: 0.38 },
  { id: 'splitTop', label: 'Split Top', xNorm: 0, yNorm: -0.25, scale: 0.92, mask: { type: 'filmstrip', scaleY: 0.5, scaleX: 1, offsetX: 0, offsetY: 0, feather: 0.01, rotation: 0, invert: false } },
  { id: 'splitBot', label: 'Split Bot', xNorm: 0, yNorm: 0.25, scale: 0.92, mask: { type: 'filmstrip', scaleY: 0.5, scaleX: 1, offsetX: 0, offsetY: 0, feather: 0.01, rotation: 0, invert: false } }
];

export const HSL_CHANNELS = [
  { idx: 0, id: 'red', label: 'Red', color: '#ff3b30' },
  { idx: 1, id: 'orange', label: 'Orange', color: '#ff9500' },
  { idx: 2, id: 'yellow', label: 'Yellow', color: '#ffcc00' },
  { idx: 3, id: 'green', label: 'Green', color: '#34c759' },
  { idx: 4, id: 'cyan', label: 'Cyan', color: '#32ade6' },
  { idx: 5, id: 'blue', label: 'Blue', color: '#007aff' },
  { idx: 6, id: 'purple', label: 'Purple', color: '#af52de' },
  { idx: 7, id: 'magenta', label: 'Magenta', color: '#ff2d55' }
];

export const CAMERA_MOTION_PRESETS = [
  { id: 'dollyIn', label: 'Dolly Push-In', icon: 'bi-zoom-in' },
  { id: 'kenBurns', label: 'Ken Burns Pan', icon: 'bi-arrows-angle-expand' },
  { id: 'orbit360', label: '3D Orbit Arc', icon: 'bi-globe2' },
  { id: 'handheld', label: 'Handheld Drift', icon: 'bi-camera-video' },
  { id: 'flip3D', label: '3D Card Flip', icon: 'bi-box' }
];

export const AUTO_EDIT_TEMPLATES = [
  { id: 'flashBeat', label: 'Flash Beat Reels', desc: 'Fast beat cuts + zoom punch + Flash Pulse VFX', badge: 'REELS', accent: '#00e5ff' },
  { id: 'carousel3D', label: '3D Photo Carousel', desc: '3D Camera Orbit + Cinema filter + Dissolve', badge: '3D', accent: '#7c4dff' },
  { id: 'vlogSplit', label: 'Vlog Travel Cut', desc: 'Warm Sunset + Hero Speed Curve + Title Intro', badge: 'VLOG', accent: '#ffab40' }
];

export const TRANSITION_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'slide', label: 'Slide & Wipe' },
  { id: 'camera', label: 'Camera / Zoom' },
  { id: 'light', label: 'Light & FX' }
];

export const TRANSITION_PRESETS = [
  { id: 'none', cat: 'basic', label: 'None', icon: 'bi-slash-circle', animClass: 'mf-tr-none', badge: '' },
  { id: 'crossfade', cat: 'basic', label: 'Dissolve', icon: 'bi-intersect', animClass: 'mf-tr-dissolve', badge: 'MIX' },
  { id: 'fadeBlack', cat: 'basic', label: 'Fade Black', icon: 'bi-moon-fill', animClass: 'mf-tr-fade-black', badge: 'FADE' },
  { id: 'mixBlur', cat: 'basic', label: 'Blur Mix', icon: 'bi-droplet-half', animClass: 'mf-tr-blur', badge: 'BLUR' },
  { id: 'flashWhite', cat: 'light', label: 'Flash White', icon: 'bi-brightness-high-fill', animClass: 'mf-tr-flash', badge: 'FLASH' },
  { id: 'glitchCut', cat: 'light', label: 'Glitch Cut', icon: 'bi-lightning-charge-fill', animClass: 'mf-tr-glitch', badge: 'FX' },
  { id: 'slideLeft', cat: 'slide', label: 'Slide Left', icon: 'bi-arrow-left-square', animClass: 'mf-tr-slide-l', badge: '' },
  { id: 'slideRight', cat: 'slide', label: 'Slide Right', icon: 'bi-arrow-right-square', animClass: 'mf-tr-slide-r', badge: '' },
  { id: 'slideUp', cat: 'slide', label: 'Slide Up', icon: 'bi-arrow-up-square', animClass: 'mf-tr-slide-u', badge: '' },
  { id: 'slideDown', cat: 'slide', label: 'Slide Down', icon: 'bi-arrow-down-square', animClass: 'mf-tr-slide-d', badge: '' },
  { id: 'wipeRight', cat: 'slide', label: 'Wipe Right', icon: 'bi-arrow-bar-right', animClass: 'mf-tr-wipe-r', badge: '' },
  { id: 'wipeLeft', cat: 'slide', label: 'Wipe Left', icon: 'bi-arrow-bar-left', animClass: 'mf-tr-wipe-l', badge: '' },
  { id: 'wipeUp', cat: 'slide', label: 'Wipe Up', icon: 'bi-arrow-bar-up', animClass: 'mf-tr-wipe-u', badge: '' },
  { id: 'wipeDown', cat: 'slide', label: 'Wipe Down', icon: 'bi-arrow-bar-down', animClass: 'mf-tr-wipe-d', badge: '' },
  { id: 'circleIris', cat: 'camera', label: 'Circle Iris', icon: 'bi-record-circle', animClass: 'mf-tr-iris', badge: 'IRIS' },
  { id: 'zoomIn', cat: 'camera', label: 'Zoom In', icon: 'bi-zoom-in', animClass: 'mf-tr-zoom-in', badge: 'ZOOM' },
  { id: 'zoomOut', cat: 'camera', label: 'Zoom Out', icon: 'bi-zoom-out', animClass: 'mf-tr-zoom-out', badge: 'ZOOM' },
  { id: 'spinIn', cat: 'camera', label: 'Spin Cut', icon: 'bi-arrow-clockwise', animClass: 'mf-tr-spin', badge: 'SPIN' }
];

export const STICKER_PACK = [
  { id: 'fire', label: 'Hot', emoji: '🔥', sub: 'TRENDING', color: '#FF6D00' },
  { id: 'bolt', label: 'Energy', emoji: '⚡', sub: 'FAST', color: '#FFD600' },
  { id: 'heart', label: 'Like', emoji: '❤️', sub: 'LOVE', color: '#FF1744' },
  { id: 'star', label: 'Top', emoji: '⭐', sub: 'VIP', color: '#FFC400' },
  { id: 'arrow', label: 'Point', emoji: '👉', sub: 'LOOK', color: '#00E5FF' },
  { id: 'pin', label: 'Loc', emoji: '📍', sub: 'SPOT', color: '#FF5252' },
  { id: 'rec', label: 'REC', emoji: '🔴', sub: 'REC', color: '#FF1744', badge: 'REC' },
  { id: 'crown', label: 'King', emoji: '👑', sub: 'PRO', color: '#FFD740' },
  { id: 'boom', label: 'Boom', emoji: '💥', sub: 'POW', color: '#FF9100' },
  { id: 'check', label: 'Verified', emoji: '✅', sub: 'OK', color: '#00E676' },
  { id: 'music', label: 'Vibe', emoji: '🎵', sub: 'BEAT', color: '#D500F9' },
  { id: 'sparkle', label: 'Magic', emoji: '✨', sub: 'FX', color: '#40C4FF' }
];

export function renderStickerPngDataUrl(sticker) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  if (sticker.badge) {
    ctx.fillStyle = 'rgba(11, 14, 20, 0.85)';
    ctx.strokeStyle = sticker.color || '#FF1744';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(18, 66, size - 36, size - 132, 28);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = sticker.color || '#FF1744';
    ctx.beginPath();
    ctx.arc(62, size / 2, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sticker.badge, size / 2 + 24, size / 2 + 3);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = sticker.color || 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.font = '150px system-ui, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';
    ctx.fillText(sticker.emoji, size / 2, size / 2 + 8);
  }
  return c.toDataURL('image/png');
}

export const SFX_PACK = [
  { id: 'whoosh', cat: 'trans', label: 'Whoosh', durMs: 550, icon: 'bi-wind', color: '#00e5ff' },
  { id: 'fastSwipe', cat: 'trans', label: 'Fast Swipe', durMs: 320, icon: 'bi-fast-forward-fill', color: '#40c4ff' },
  { id: 'riser', cat: 'trans', label: 'Sweep Riser', durMs: 1100, icon: 'bi-graph-up-arrow', color: '#b388ff' },
  { id: 'glitchZap', cat: 'trans', label: 'Glitch Zap', durMs: 360, icon: 'bi-lightning-charge-fill', color: '#00e5ff' },
  { id: 'pop', cat: 'ui', label: 'Bubble Pop', durMs: 180, icon: 'bi-circle-fill', color: '#ff4081' },
  { id: 'click', cat: 'ui', label: 'Crisp Click', durMs: 90, icon: 'bi-mouse2-fill', color: '#eef2f8' },
  { id: 'ding', cat: 'ui', label: 'Bell Ding', durMs: 700, icon: 'bi-bell-fill', color: '#69f0ae' },
  { id: 'chime', cat: 'ui', label: 'Spark Chime', durMs: 850, icon: 'bi-stars', color: '#40c4ff' },
  { id: 'boom', cat: 'impact', label: 'Bass Boom', durMs: 900, icon: 'bi-soundwave', color: '#ff5252' },
  { id: 'subDrop', cat: 'impact', label: '808 Drop', durMs: 800, icon: 'bi-arrow-down-circle-fill', color: '#ff4081' },
  { id: 'snare', cat: 'impact', label: 'Punch Hit', durMs: 260, icon: 'bi-disc-fill', color: '#ffab40' },
  { id: 'clap', cat: 'impact', label: 'Crowd Clap', durMs: 340, icon: 'bi-hand-thumbs-up-fill', color: '#69f0ae' },
  { id: 'shutter', cat: 'retro', label: 'Camera Snap', durMs: 220, icon: 'bi-camera-fill', color: '#ffd740' },
  { id: 'coin', cat: 'retro', label: '8-Bit Coin', durMs: 380, icon: 'bi-coin', color: '#ffd740' },
  { id: 'laser', cat: 'retro', label: 'Retro Laser', durMs: 420, icon: 'bi-broadcast', color: '#b388ff' },
  { id: 'beepError', cat: 'retro', label: 'Censor Beep', durMs: 500, icon: 'bi-exclamation-triangle-fill', color: '#ff5252' }
];

export function synthesizeSfxWavDataUrl(sfxId) {
  const sampleRate = 22050;
  const spec = SFX_PACK.find((s) => s.id === sfxId) || SFX_PACK[0];
  const numSamples = Math.max(1024, Math.round((spec.durMs / 1000) * sampleRate));
  const pcm = new Int16Array(numSamples);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  let lpState = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const p = i / numSamples;
    let sample = 0;

    if (sfxId === 'whoosh') {
      const env = Math.sin(Math.PI * p);
      const cutoff = 0.04 + 0.25 * Math.sin(Math.PI * p);
      lpState += (rand() - lpState) * cutoff;
      sample = lpState * env * 0.9;
    } else if (sfxId === 'fastSwipe') {
      const env = Math.pow(Math.sin(Math.PI * p), 0.7);
      const cutoff = 0.12 + 0.45 * (1 - p);
      lpState += (rand() - lpState) * cutoff;
      sample = (lpState * 0.7 + Math.sin(2 * Math.PI * (340 - 220 * p) * t) * 0.35) * env;
    } else if (sfxId === 'glitchZap') {
      const env = Math.pow(1 - p, 1.3);
      const stepFreq = 180 + (Math.floor(p * 12) % 3) * 390;
      sample = (Math.sign(Math.sin(2 * Math.PI * stepFreq * t)) * 0.5 + rand() * 0.35) * env;
    } else if (sfxId === 'pop') {
      const freq = 260 + (1 - p) * 620;
      const env = Math.pow(1 - p, 2.2);
      sample = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
    } else if (sfxId === 'click') {
      const env = Math.exp(-t * 95);
      sample = (Math.sin(2 * Math.PI * 1950 * t) * 0.65 + rand() * 0.45) * env;
    } else if (sfxId === 'boom') {
      const freq = 140 * Math.pow(0.28, p) + 36;
      const env = Math.pow(1 - p, 1.5);
      sample = (Math.sin(2 * Math.PI * freq * t) * 0.85 + rand() * 0.15 * Math.pow(1 - p, 4)) * env;
    } else if (sfxId === 'subDrop') {
      const freq = 95 * Math.pow(0.42, p) + 28;
      const env = Math.min(1, p * 18) * Math.pow(1 - p, 1.2);
      sample = Math.sin(2 * Math.PI * freq * t) * env * 0.92;
    } else if (sfxId === 'snare') {
      const toneEnv = Math.exp(-t * 28);
      const noiseEnv = Math.exp(-t * 18);
      sample = Math.sin(2 * Math.PI * 185 * t) * toneEnv * 0.65 + rand() * noiseEnv * 0.65;
    } else if (sfxId === 'clap') {
      const b = ((i % 420) < 160 && p < 0.25) ? 0.9 : Math.exp(-t * 14);
      sample = rand() * b * 0.82;
    } else if (sfxId === 'shutter') {
      const burst1 = p < 0.18 ? Math.sin(Math.PI * (p / 0.18)) : 0;
      const burst2 = p > 0.35 && p < 0.55 ? Math.sin(Math.PI * ((p - 0.35) / 0.2)) : 0;
      sample = rand() * (burst1 + burst2 * 0.8) * 0.85;
    } else if (sfxId === 'ding') {
      const env = Math.exp(-t * 6.5);
      sample = (Math.sin(2 * Math.PI * 1046.5 * t) * 0.65 + Math.sin(2 * Math.PI * 2093 * t) * 0.25) * env;
    } else if (sfxId === 'chime') {
      const env = Math.exp(-t * 4.5);
      sample = (Math.sin(2 * Math.PI * 880 * t) * 0.35 + Math.sin(2 * Math.PI * 1318.5 * t) * 0.35 + Math.sin(2 * Math.PI * 1760 * t) * 0.25) * env;
    } else if (sfxId === 'coin') {
      const freq = p < 0.26 ? 987.77 : 1318.51;
      const env = Math.exp(-t * 5.8);
      sample = Math.sign(Math.sin(2 * Math.PI * freq * t)) * env * 0.45;
    } else if (sfxId === 'laser') {
      const freq = 1400 * Math.pow(0.16, p);
      const env = Math.pow(1 - p, 1.1);
      sample = Math.sin(2 * Math.PI * freq * t) * env * 0.78;
    } else if (sfxId === 'beepError') {
      const env = p < 0.04 ? p / 0.04 : p > 0.94 ? (1 - p) / 0.06 : 1;
      sample = Math.sin(2 * Math.PI * 1000 * t) * env * 0.55;
    } else {
      // riser
      const freq = 180 + Math.pow(p, 1.8) * 1200;
      const env = Math.min(1, p * 1.4) * (p > 0.92 ? (1 - p) / 0.08 : 1);
      sample = (Math.sin(2 * Math.PI * freq * t) * 0.55 + rand() * 0.25) * env * 0.75;
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }

  const dataByteLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataByteLen);
  const view = new DataView(buf);
  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataByteLen, true);

  const bytes = new Uint8Array(buf);
  bytes.set(new Uint8Array(pcm.buffer), 44);
  let bin = '';
  const chunk = 4096;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/**
 * Parses either standard .SRT subtitle blocks (00:00:01,500 --> 00:00:04,000)
 * or plain newline-separated lyrics into timed frame cue segments.
 */
export function parseSrtOrLyrics(rawText, fps = 30, baseStartFrame = 0, secPerLine = 2.0) {
  const clean = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const safeFps = Math.max(1, fps || 30);

  const timeToSec = (tc) => {
    const m = tc.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!m) return 0;
    const ms = m[4].padEnd(3, '0').slice(0, 3);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(ms) / 1000;
  };

  const srtBlocks = clean.split(/\n{2,}/);
  const parsedSrt = [];
  for (const blk of srtBlocks) {
    const lines = blk.split('\n').map((l) => l.trim()).filter(Boolean);
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx >= 0) {
      const [left, right] = lines[arrowIdx].split('-->').map((s) => s.trim());
      const startSec = timeToSec(left);
      const endSec = Math.max(startSec + 0.35, timeToSec(right));
      const text = lines.slice(arrowIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (text) {
        parsedSrt.push({
          startFrame: Math.max(0, Math.round(startSec * safeFps)),
          endFrame: Math.max(15, Math.round(endSec * safeFps)),
          text
        });
      }
    }
  }
  if (parsedSrt.length > 0) return parsedSrt;

  // Fallback: split plain lyric lines evenly starting from baseStartFrame
  const stepFrames = Math.max(15, Math.round((secPerLine || 2.0) * safeFps));
  const rawLines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  return rawLines.map((line, idx) => {
    const startFrame = Math.max(0, Math.round(baseStartFrame) + idx * stepFrames);
    return {
      startFrame,
      endFrame: startFrame + stepFrames,
      text: line
    };
  });
}
