/**
 * Scoped stylesheet for the Spend UI. Every value is a Halyard token (--fl-*) with the dark value as fallback,
 * so the component renders correctly with or without tokens.css loaded. Everything lives under .fls-root.
 */
const FALLBACK = {
  'font-display': "'Instrument Serif', Georgia, serif",
  'font-sans': "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
  'font-mono': "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  'text-2xs': '0.6875rem',
  'text-xs': '0.75rem',
  'text-sm': '0.8125rem',
  'text-md': '0.9375rem',
  'text-lg': '1.125rem',
  'text-xl': '1.5rem',
  'text-2xl': '2.25rem',
  'text-3xl': '3.5rem',
  'leading-tight': '1.1',
  'leading-normal': '1.5',
  'tracking-caps': '0.08em',
  'space-1': '2px',
  'space-2': '4px',
  'space-3': '8px',
  'space-4': '12px',
  'space-5': '16px',
  'space-6': '24px',
  'space-7': '32px',
  'space-8': '48px',
  'space-9': '64px',
  'radius-xs': '2px',
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '10px',
  'radius-pill': '999px',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'dur-fast': '140ms',
  'dur-base': '220ms',
  'dur-slow': '420ms',
  'dur-cinematic': '900ms',
  bg: '#0b0d0c',
  'surface-1': '#121514',
  'surface-2': '#181c1a',
  'surface-3': '#20251f',
  border: 'rgba(233, 226, 207, 0.09)',
  'border-strong': 'rgba(233, 226, 207, 0.18)',
  fg: '#ece7da',
  'fg-muted': '#a7a596',
  'fg-subtle': '#8a8b82',
  accent: '#ff6a2b',
  'accent-fg': '#0b0d0c',
  success: '#9be564',
  warn: '#f5b83d',
  danger: '#ff5964',
  info: '#7fd1d9',
  focus: '#ffb547',
  'series-1': '#ff6a2b',
  'series-2': '#7fd1d9',
  'series-3': '#b6e85a',
  'series-4': '#f5b83d',
  'series-5': '#e58ac9',
  'series-6': '#e9e2cf',
  'series-7': '#5fa88a',
  'series-8': '#c98b5a',
  'model-opus': '#ff6a2b',
  'model-sonnet': '#7fd1d9',
  'model-haiku': '#b6e85a',
  'model-fable': '#e9e2cf',
  'model-astra': '#e58ac9',
  'model-unknown': '#8a8f88',
  'elev-1': '0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 1px 2px rgba(0, 0, 0, 0.5)',
  'elev-2': '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 24px rgba(0, 0, 0, 0.45)',
} as const;

export type Token = keyof typeof FALLBACK;

/** var(--fl-<name>, <dark fallback>) */
export const t = (name: Token): string => `var(--fl-${name}, ${FALLBACK[name]})`;

/** Translucent wash of a token color over the surface. */
const wash = (name: Token, amount: number): string =>
  `color-mix(in srgb, ${t(name)} ${amount}%, transparent)`;

const R = '.fls-root';

export const SPEND_CSS = `
${R}{container-type:inline-size;container-name:fls;font-family:${t('font-sans')};font-size:${t('text-md')};line-height:${t('leading-normal')};color:${t('fg')};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
${R} *,${R} *::before,${R} *::after{box-sizing:border-box}
${R} h2,${R} h3,${R} p,${R} ul,${R} ol,${R} figure,${R} dl,${R} dd{margin:0;padding:0}
${R} ul,${R} ol{list-style:none}
${R} :focus{outline:none}
${R} :focus-visible{outline:2px solid ${t('focus')};outline-offset:2px;border-radius:${t('radius-sm')}}
${R} .fls-num{font-family:${t('font-mono')};font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"zero" 0;letter-spacing:-0.01em}
${R} .fls-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
${R} .fls-stack{display:flex;flex-direction:column;gap:${t('space-5')}}
${R} .fls-eyebrow{font-family:${t('font-mono')};font-size:${t('text-2xs')};line-height:1.5;letter-spacing:${t('tracking-caps')};text-transform:uppercase;color:${t('fg-muted')};font-weight:500}
${R} .fls-muted{color:${t('fg-muted')}}
${R} .fls-subtle{color:${t('fg-muted')}}
${R} .fls-icon{width:20px;height:20px;flex:none;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
${R} .fls-icon-sm{width:16px;height:16px}

/* panels */
${R} .fls-panel{background:linear-gradient(180deg,${t('surface-1')},color-mix(in srgb, ${t('surface-1')} 70%, ${t('bg')}));border:1px solid ${t('border')};border-radius:${t('radius-lg')};padding:${t('space-6')};box-shadow:${t('elev-1')};min-width:0}
${R} .fls-panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:${t('space-3')} ${t('space-5')};margin-bottom:${t('space-5')}}
${R} .fls-panel-title{font-family:${t('font-mono')};font-size:${t('text-2xs')};font-weight:500;line-height:1.5;letter-spacing:${t('tracking-caps')};text-transform:uppercase;color:${t('fg-muted')}}
${R} .fls-panel-note{font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} .fls-grid{display:grid;gap:${t('space-5')};grid-template-columns:minmax(0,1fr)}
@container fls (min-width: 860px){
  ${R} .fls-grid-2{grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start}
}

/* header */
${R} .fls-header{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:${t('space-5')};padding:${t('space-2')} 0 ${t('space-3')}}
${R} .fls-title{font-family:${t('font-display')};font-weight:400;font-size:${t('text-2xl')};line-height:${t('leading-tight')};letter-spacing:-0.01em;margin-top:${t('space-2')}}
${R} .fls-meta{display:flex;flex-wrap:wrap;gap:${t('space-3')};align-items:center;font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} .fls-hero-meta{justify-content:flex-start;margin-top:${t('space-5')};max-width:100%}
${R} .fls-hero-top>div:first-child{min-width:0;max-width:100%}
${R} .fls-chip{display:inline-flex;flex:none;align-items:center;gap:${t('space-3')};height:26px;padding:0 ${t('space-4')};border:1px solid ${t('border')};border-radius:${t('radius-pill')};background:${t('surface-1')};white-space:nowrap;font-family:${t('font-mono')};font-size:${t('text-2xs')}}
${R} .fls-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
${R} [data-tint=idle]{color:${t('fg-muted')}}
${R} [data-tint=cool]{color:${t('info')}}
${R} [data-tint=warm]{color:${t('warn')}}
${R} [data-tint=hot]{color:${t('danger')}}
${R} .fls-chip .fls-chip-label{color:${t('fg-muted')}}
${R} .fls-badge{display:inline-flex;white-space:nowrap;align-items:center;gap:${t('space-2')};font-family:${t('font-mono')};font-size:${t('text-2xs')};font-weight:500;letter-spacing:${t('tracking-caps')};text-transform:uppercase;padding:${t('space-1')} ${t('space-3')};border-radius:${t('radius-sm')};border:1px solid ${t('border-strong')};color:${t('fg-muted')}}
${R} .fls-badge-warn{color:${t('warn')};border-color:${wash('warn', 40)};background:${wash('warn', 8)}}

/* banners */
${R} .fls-banner{display:flex;gap:${t('space-4')};align-items:flex-start;padding:${t('space-4')} ${t('space-5')};border-radius:${t('radius-md')};border:1px solid ${t('border')};background:${t('surface-1')};font-size:${t('text-sm')}}
${R} .fls-banner strong{font-weight:600;color:${t('fg')}}
${R} .fls-banner p{color:${t('fg-muted')}}
${R} .fls-banner-warn{border-color:${wash('warn', 35)};background:${wash('warn', 6)}}
${R} .fls-banner-warn>.fls-icon{color:${t('warn')}}
${R} .fls-banner-danger{border-color:${wash('danger', 40)};background:${wash('danger', 7)}}
${R} .fls-banner-danger>.fls-icon{color:${t('danger')}}
${R} .fls-banner-info>.fls-icon{color:${t('fg-muted')}}

/* KPI strip */
${R} .fls-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:${t('border')};border:1px solid ${t('border')};border-radius:${t('radius-lg')};overflow:hidden}
${R} .fls-kpi{background:${t('surface-1')};padding:${t('space-5')} ${t('space-6')} ${t('space-6')};display:flex;flex-direction:column;gap:${t('space-2')};min-width:0}
${R} .fls-kpi-value{font-size:${t('text-xl')};font-weight:500;line-height:1.2;color:${t('fg')};white-space:nowrap}
${R} .fls-kpi-hero .fls-kpi-value{font-size:${t('text-2xl')}}
${R} .fls-kpi-sub{font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} .fls-kpi-sub .fls-num{color:${t('fg')}}
${R} .fls-meter{position:relative;height:4px;border-radius:${t('radius-pill')};background:${t('surface-3')};margin-top:${t('space-3')};overflow:visible}
${R} .fls-meter>span{position:absolute;inset:0 auto 0 0;border-radius:${t('radius-pill')};background:${t('fg-muted')}}
${R} .fls-meter[data-state=warn]>span{background:${t('warn')}}
${R} .fls-meter[data-state=over]>span{background:${t('danger')}}
${R} .fls-meter>i{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;border-radius:1px;background:${t('fg')}}
${R} .fls-meter-cap{display:flex;align-items:center;gap:${t('space-2')};font-size:${t('text-2xs')};color:${t('fg-muted')};margin-top:${t('space-3')}}
${R} .fls-meter-cap::before{content:"";width:2px;height:10px;border-radius:1px;background:${t('fg')}}
${R} .fls-tone{display:inline-flex;align-items:center;gap:${t('space-3')}}
${R} .fls-tone::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
${R} .fls-tone[data-tone=over]{color:${t('danger')}}
${R} .fls-tone[data-tone=good]{color:${t('success')}}
${R} .fls-tone>span{color:${t('fg-muted')}}
${R} .fls-tone-warn{color:${t('warn')}}
${R} .fls-tone-over{color:${t('danger')}}
${R} .fls-tone-good{color:${t('success')}}

@container fls (min-width: 760px){
  ${R} .fls-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@container fls (max-width: 400px){
  ${R} .fls-kpis{grid-template-columns:minmax(0,1fr)}
}
/* hero: the focal point */
${R} .fls-hero{position:relative;overflow:hidden;padding:${t('space-7')} ${t('space-7')} ${t('space-6')};border-radius:${t('radius-lg')};border:1px solid ${t('border')};background:radial-gradient(120% 90% at 0% 0%,${wash('accent', 11)},transparent 55%),radial-gradient(80% 60% at 100% 100%,${wash('accent', 5)},transparent 60%),linear-gradient(180deg,${t('surface-1')},${t('bg')});box-shadow:${t('elev-2')}}
${R} .fls-hero-num{display:block;font-family:${t('font-mono')};font-weight:500;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"zero" 0;font-size:clamp(3rem,12cqi,6.5rem);line-height:0.95;letter-spacing:-0.03em;color:${t('fg')};margin-top:${t('space-4')}}
${R} .fls-hero-num .fls-cents{color:${t('fg-muted')}}
${R} .fls-hero-sep{font-family:${t('font-mono')};font-weight:500;color:${t('fg-muted')};margin:0 -0.16em}
${R} .fls-hero-line{font-family:${t('font-display')};font-size:clamp(1.25rem,3.2cqi,1.75rem);line-height:1.25;letter-spacing:var(--fl-tracking-display, -0.01em);color:${t('fg-muted')};margin-top:${t('space-4')};max-width:44ch;text-wrap:balance}
${R} .fls-hero-line .fls-num{font-size:0.82em;color:${t('fg')};letter-spacing:-0.02em}
${R} .fls-hero-line .fls-tone-warn{color:${t('warn')}}
${R} .fls-hero-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:${t('space-5')}}
${R} .fls-hero .fls-chart{margin-top:${t('space-7')}}
/* entrance: one choreographed moment (transform/opacity only) */
@keyframes fls-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes fls-grow{from{transform:scaleY(0)}to{transform:none}}
@keyframes fls-fade{from{opacity:0}to{opacity:1}}
${R} .fls-hero-num,${R} .fls-hero-line{animation:fls-rise ${t('dur-slow')} ${t('ease-out')} both}
${R} .fls-hero-line{animation-delay:80ms}
${R} .fls-draw{transform-origin:50% 100%;animation:fls-grow ${t('dur-cinematic')} ${t('ease-out')} 120ms both}
${R} .fls-late{animation:fls-fade ${t('dur-slow')} ${t('ease-out')} 700ms both}
${R} .fls-kpi{animation:fls-rise ${t('dur-slow')} ${t('ease-out')} both}
${R} .fls-kpi:nth-child(2){animation-delay:60ms}
${R} .fls-kpi:nth-child(3){animation-delay:120ms}
${R} .fls-kpi:nth-child(4){animation-delay:180ms}
${R} .fls-lede{font-size:${t('text-lg')};line-height:1.45;color:${t('fg-muted')};max-width:60ch}
${R} .fls-lede .fls-num{color:${t('fg')}}
${R} .fls-legend{display:flex;flex-wrap:wrap;gap:${t('space-3')} ${t('space-5')};font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} .fls-legend li{display:inline-flex;align-items:center;gap:${t('space-3')}}
${R} .fls-key{display:inline-block;width:16px;height:0;border-top:2px solid currentColor}
${R} .fls-key-dash{border-top-style:dashed}
${R} .fls-key-band{height:10px;border:0;border-radius:${t('radius-xs')};background:${wash('accent', 18)}}
${R} .fls-key-swatch{width:10px;height:10px;border:0;border-radius:${t('radius-xs')};background:currentColor}
${R} .fls-chart{position:relative;margin-top:${t('space-5')};--fls-gutter:48px;padding-left:var(--fls-gutter)}
${R} .fls-plot{position:relative;height:clamp(200px,32cqi,320px);margin:0 0 0 0}
${R} .fls-plot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
${R} .fls-grid-line{stroke:${t('border')};stroke-width:1}
${R} .fls-axis-line{stroke:${t('border-strong')};stroke-width:1}
${R} .fls-ytick{position:absolute;left:calc(-1 * var(--fls-gutter));width:calc(var(--fls-gutter) - ${t('space-3')});transform:translateY(-50%);text-align:right;font-size:${t('text-xs')};line-height:1;color:${t('fg-subtle')};pointer-events:none}
${R} .fls-xaxis{position:relative;height:22px;margin-top:${t('space-3')};font-size:${t('text-xs')};color:${t('fg-subtle')}}
${R} .fls-xaxis span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
${R} .fls-xaxis span:first-child{transform:none}
${R} .fls-xaxis span:last-child{transform:translateX(-100%)}
${R} .fls-line-actual{fill:none;stroke:${t('accent')};stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
${R} .fls-line-forecast{fill:none;stroke:${t('accent')};stroke-width:2;stroke-dasharray:5 5;stroke-linecap:round;opacity:.9}
${R} .fls-area{fill:${wash('accent', 9)}}
${R} .fls-band{fill:${wash('accent', 14)}}
${R} .fls-budget-line{stroke:${t('fg-muted')};stroke-width:1;stroke-dasharray:2 3}
${R} .fls-today-line{stroke:${t('border-strong')};stroke-width:1}
${R} .fls-tag{position:absolute;z-index:2;font-size:${t('text-2xs')};white-space:nowrap;pointer-events:none;line-height:1.3;text-shadow:0 0 2px ${t('surface-1')},0 0 4px ${t('surface-1')},0 0 6px ${t('surface-1')}}
${R} .fls-tag-budget{right:0;padding-top:4px;font-size:${t('text-xs')};font-weight:500;color:${t('fg')}}
${R} .fls-tag-today{right:0;transform:translateY(calc(-100% - 4px));padding:1px 6px;border-radius:${t('radius-sm')};background:${t('surface-1')};border:1px solid ${t('border-strong')};font-size:${t('text-xs')};color:${t('fg')};font-weight:500}
${R} .fls-tag-end{right:0;transform:translate(0,calc(-100% - 8px));padding:1px 6px;border-radius:${t('radius-sm')};background:${t('surface-1')};color:${t('fg')};border:1px solid ${t('border-strong')}}
${R} .fls-marker{position:absolute;z-index:1;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:${t('accent')};box-shadow:0 0 0 2px ${t('surface-1')};pointer-events:none}
${R} .fls-marker-cross{background:${t('surface-1')};border:2px solid ${t('danger')}}
${R} .fls-callout{position:absolute;z-index:2;transform:translate(calc(-100% - 10px),calc(-100% - 10px));text-shadow:0 0 2px ${t('surface-1')},0 0 4px ${t('surface-1')},0 0 6px ${t('surface-1')};box-shadow:0 0 0 3px ${t('surface-1')};font-size:${t('text-2xs')};color:${t('danger')};font-weight:600;white-space:nowrap;padding:2px 6px;border-radius:${t('radius-sm')};background:${t('surface-1')};border:1px solid ${wash('danger', 45)};pointer-events:none}
${R} .fls-callout[data-edge=start]{transform:translate(10px,10px)}

/* hover layer (shared by hero + bars) */
${R} .fls-hit{position:absolute;inset:0;display:flex}
${R} .fls-hit>div{flex:1 1 0;position:relative;cursor:default}
${R} .fls-cross{position:absolute;top:0;bottom:0;left:50%;width:1px;background:${t('fg-subtle')};opacity:0;transition:opacity ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-hit>div[data-active=true] .fls-cross{opacity:.8}
${R} .fls-tip{position:absolute;z-index:3;top:0;left:50%;transform:translate(-50%,calc(-100% - 8px));min-width:140px;padding:${t('space-3')} ${t('space-4')};border-radius:${t('radius-md')};background:${t('surface-3')};border:1px solid ${t('border-strong')};box-shadow:${t('elev-2')};font-size:${t('text-xs')};color:${t('fg')};pointer-events:none;white-space:nowrap}
${R} .fls-tip[data-edge=start]{left:0;transform:translate(0,calc(-100% - 8px))}
${R} .fls-tip[data-edge=end]{left:auto;right:0;transform:translate(0,calc(-100% - 8px))}
${R} .fls-tip dl{display:grid;grid-template-columns:auto auto;gap:2px ${t('space-4')};margin-top:${t('space-2')}}
${R} .fls-tip dt{color:${t('fg-muted')}}
${R} .fls-tip dd{text-align:right}
${R} .fls-tip-title{font-weight:600}
${R} .fls-chart-focus{border-radius:${t('radius-md')}}

/* daily bars */
${R} .fls-bars{position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px}
${R} .fls-bars>div{flex:1 1 0;position:relative;height:100%;display:flex;align-items:flex-end}
${R} .fls-bar{width:100%;min-height:1px;border-radius:${t('radius-xs')} ${t('radius-xs')} 0 0;background:${t('fg-subtle')};opacity:.55;transition:opacity ${t('dur-fast')} ${t('ease-out')},background-color ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-bar[data-month=current]{background:${wash('accent', 35)};opacity:1}
${R} .fls-bar[data-today=true]{background:${t('accent')};opacity:1}
${R} .fls-bars>div[data-active=true] .fls-bar{opacity:1;background:${t('fg')}}
${R} .fls-bars-wrap{height:clamp(140px,20cqi,200px);margin-top:${t('space-7')}}

/* segmented control */
${R} .fls-seg{display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;scroll-snap-type:x proximity;gap:2px;padding:2px;border-radius:${t('radius-md')};background:${t('surface-2')};border:1px solid ${t('border')}}
${R} .fls-seg button{appearance:none;border:0;background:transparent;font:inherit;font-size:${t('text-xs')};font-weight:500;color:${t('fg-muted')};padding:${t('space-2')} ${t('space-4')};min-height:28px;border-radius:${t('radius-sm')};cursor:pointer;transition:background-color ${t('dur-fast')} ${t('ease-out')},color ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-seg button:hover{color:${t('fg')}}
${R} .fls-seg button:active{transform:scale(0.96)}
${R} .fls-seg button{white-space:nowrap;transition:transform ${t('dur-fast')} ${t('ease-out')},background-color ${t('dur-fast')} ${t('ease-out')},color ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-seg button[aria-selected=true]{background:${t('surface-3')};color:${t('fg')};box-shadow:${t('elev-1')}}

/* ranked bars */
${R} .fls-rank{display:flex;flex-direction:column;gap:${t('space-1')}}
${R} .fls-rank li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;column-gap:${t('space-4')};row-gap:${t('space-2')};padding:${t('space-3')} ${t('space-3')};margin:0 calc(-1 * ${t('space-3')});border-radius:${t('radius-sm')};transition:background-color ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-rank li:hover,${R} .fls-rank li:focus-visible{background:${t('surface-2')}}
${R} .fls-rank-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${t('text-sm')}}
${R} .fls-rank-value{font-size:${t('text-sm')};text-align:right}
${R} .fls-rank-share{font-size:${t('text-xs')};color:${t('fg-muted')};text-align:right;min-width:3.5ch}
${R} .fls-rank-track{grid-column:1/-1;height:6px;border-radius:${t('radius-pill')};background:${t('surface-2')};overflow:hidden}
${R} .fls-rank-track>span{display:block;height:100%;border-radius:${t('radius-pill')};background:${t('accent')};opacity:.85}
${R} .fls-rank-more{font-size:${t('text-xs')};color:${t('fg-muted')};padding-top:${t('space-3')}}
${R} .fls-empty{font-size:${t('text-sm')};color:${t('fg-muted')};padding:${t('space-6')} 0;text-align:center}

/* model mix */
${R} .fls-mix{display:flex;flex-direction:column;gap:${t('space-5')}}
${R} .fls-mix-row{display:flex;flex-direction:column;gap:${t('space-3')}}
${R} .fls-mix-head{display:flex;justify-content:space-between;font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} .fls-mix-bar{display:flex;gap:2px;height:28px}
${R} .fls-mix-bar>span{display:block;height:100%;min-width:3px;background:currentColor}
${R} .fls-mix-bar>span:first-child{border-radius:${t('radius-sm')} 0 0 ${t('radius-sm')}}
${R} .fls-mix-bar>span:last-child{border-radius:0 ${t('radius-sm')} ${t('radius-sm')} 0}
${R} .fls-mix-bar>span:only-child{border-radius:${t('radius-sm')}}
${R} .fls-mix-table{width:100%;border-collapse:collapse;font-size:${t('text-xs')}}
${R} .fls-mix-table th{font-weight:500;color:${t('fg-muted')};text-align:right;padding:0 0 ${t('space-3')}}
${R} .fls-mix-table th:first-child{text-align:left}
${R} .fls-mix-table td{padding:${t('space-2')} 0;border-top:1px solid ${t('border')};text-align:right;color:${t('fg')}}
${R} .fls-mix-table td:first-child{text-align:left;color:${t('fg')};max-width:0;width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${R} .fls-mix-table td:first-child .fls-key-swatch{margin-right:${t('space-3')};vertical-align:-1px}

/* savings */
${R} .fls-savings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:${t('space-4')}}
${R} .fls-saving{display:flex;flex-direction:column;gap:${t('space-3')};padding:${t('space-5')};border-radius:${t('radius-md')};background:${t('surface-2')};border:1px solid ${t('border')}}
${R} .fls-saving-amt{font-family:${t('font-mono')};font-size:${t('text-xl')};font-weight:500;color:${t('fg')};line-height:1.1;display:flex;align-items:baseline;gap:${t('space-3')}}
${R} .fls-saving-amt::before{content:"";width:8px;height:8px;border-radius:50%;background:${t('success')};align-self:center}
${R} .fls-saving-amt small{font-family:${t('font-sans')};font-size:${t('text-xs')};color:${t('fg-muted')};font-weight:400;margin-left:2px}
${R} .fls-saving h3{font-size:${t('text-sm')};font-weight:600}
${R} .fls-saving p{font-size:${t('text-xs')};color:${t('fg-muted')};line-height:1.5}

/* sources */
${R} .fls-sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:${t('space-3')} ${t('space-6')}}
${R} .fls-source{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:${t('space-3')};align-items:center;padding:${t('space-3')} 0;border-top:1px solid ${t('border')};font-size:${t('text-sm')}}
${R} .fls-source small{grid-column:2/-1;font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} [data-status=ok]{color:${t('success')}}
${R} [data-status=missing]{color:${t('fg-muted')}}
${R} [data-status=error]{color:${t('danger')}}
${R} .fls-status{font-size:${t('text-xs')};text-align:right}
${R} .fls-footnote{font-size:${t('text-xs')};color:${t('fg-subtle')};display:flex;flex-wrap:wrap;gap:${t('space-2')} ${t('space-5')};padding-top:${t('space-2')}}

/* skeleton */
${R} .fls-skel{position:relative;overflow:hidden;background:color-mix(in srgb, ${t('fg')} 7%, ${t('surface-2')});border-radius:${t('radius-sm')}}
${R} .fls-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,${wash('fg', 9)},transparent);animation:fls-shimmer 1.6s ${t('ease-out')} infinite}
@keyframes fls-shimmer{to{transform:translateX(100%)}}

/* onboarding */
${R} .fls-onboard{display:grid;gap:${t('space-6')};grid-template-columns:minmax(0,1fr)}
@container fls (min-width: 860px){
  ${R} .fls-onboard{grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:${t('space-8')}}
}
${R} .fls-onboard h2{font-family:${t('font-display')};font-weight:400;font-size:${t('text-2xl')};line-height:${t('leading-tight')}}
${R} .fls-onboard-intro{display:flex;flex-direction:column;gap:${t('space-4')}}
${R} .fls-onboard-intro p{color:${t('fg-muted')};font-size:${t('text-md')}}
${R} .fls-steps li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:${t('space-1')} ${t('space-4')};padding:${t('space-4')} 0;border-top:1px solid ${t('border')}}
${R} .fls-steps li:first-child{border-top:0;padding-top:0}
${R} .fls-steps .fls-icon{color:${t('fg-muted')};margin-top:1px}
${R} .fls-steps strong{font-weight:600;font-size:${t('text-sm')}}
${R} .fls-steps p{grid-column:2;font-size:${t('text-xs')};color:${t('fg-muted')}}
${R} code,${R} .fls-code{font-family:${t('font-mono')};font-size:0.92em;padding:1px 5px;border-radius:${t('radius-xs')};background:${t('surface-3')};color:${t('fg')}}
${R} .fls-cmd{display:flex;align-items:center;gap:${t('space-4')};padding:${t('space-4')} ${t('space-5')};border-radius:${t('radius-md')};background:${t('bg')};border:1px solid ${t('border-strong')};font-family:${t('font-mono')};font-size:${t('text-md')};color:${t('fg')};width:fit-content;max-width:100%;overflow-x:auto}
${R} .fls-cmd code{background:none;padding:0;font-size:inherit}
${R} .fls-copy{appearance:none;font:inherit;font-family:${t('font-sans')};font-size:${t('text-xs')};font-weight:500;color:${t('fg-muted')};background:${t('surface-2')};border:1px solid ${t('border-strong')};border-radius:${t('radius-sm')};padding:${t('space-1')} ${t('space-4')};cursor:pointer;transition:transform ${t('dur-fast')} ${t('ease-out')},color ${t('dur-fast')} ${t('ease-out')}}
${R} .fls-copy:hover{color:${t('fg')}}
${R} .fls-copy:active{transform:scale(0.96)}
${R} .fls-errmsg{margin:0;font-family:${t('font-mono')};font-size:${t('text-sm')};line-height:1.5;white-space:pre-wrap;word-break:break-word;color:${t('fg')};padding:${t('space-4')} ${t('space-5')};border-radius:${t('radius-md')};background:${wash('danger', 7)};border:1px solid ${wash('danger', 35)};border-left:3px solid ${t('danger')}}
${R} a.fls-badge{text-decoration:none}
${R} a.fls-badge:hover{background:${wash('warn', 14)}}
/* site narrative */
${R} .fls-preview-clip{max-height:1180px;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,currentColor calc(100% - 160px),transparent);mask-image:linear-gradient(180deg,currentColor calc(100% - 160px),transparent)}
${R} .fls-preview-clip .fls-meta{display:none}
${R} .fls-callouts{display:grid;gap:${t('space-6')};grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin-top:${t('space-8')}}
${R} .fls-callout-card{display:flex;flex-direction:column;gap:${t('space-3')};padding-top:${t('space-5')};border-top:1px solid ${t('border-strong')}}
${R} .fls-callout-card .fls-eyebrow{color:${t('accent')}}
${R} .fls-callout-card h3{font-family:${t('font-display')};font-weight:400;font-size:${t('text-xl')};line-height:1.15}
${R} .fls-callout-card p{font-size:${t('text-sm')};color:${t('fg-muted')}}
${R} .fls-callout-card .fls-stat{font-family:${t('font-mono')};font-size:${t('text-sm')};color:${t('fg')}}
${R} .fls-cta{margin-top:${t('space-9')};display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:${t('space-6')};padding:${t('space-8')} ${t('space-7')};border-radius:${t('radius-lg')};border:1px solid ${t('border')};background:radial-gradient(90% 140% at 100% 0%,${wash('accent', 14)},transparent 60%),linear-gradient(180deg,${t('surface-1')},${t('bg')})}
${R} .fls-cta h3{font-family:${t('font-display')};font-weight:400;font-size:clamp(1.75rem,4.5cqi,2.75rem);line-height:1.05;letter-spacing:var(--fl-tracking-display, -0.015em)}
${R} .fls-cta p{font-size:${t('text-sm')};color:${t('fg-muted')};margin-top:${t('space-3')}}
${R} .fls-cmd::before{content:"$";color:${t('fg-muted')}}

/* site section */
${R}.fls-site{max-width:1200px;margin:0 auto;padding:${t('space-9')} ${t('space-5')}}
${R} .fls-site-head{display:grid;gap:${t('space-6')};grid-template-columns:minmax(0,1fr);margin-bottom:${t('space-8')}}
@container fls (min-width: 860px){
  ${R} .fls-site-head{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:end;gap:${t('space-8')}}
}
${R}.fls-site>.fls-site-head h2{font-family:${t('font-display')};font-weight:400;font-size:clamp(2.5rem,7cqi,5.5rem);line-height:0.98;letter-spacing:var(--fl-tracking-display, -0.02em);margin-top:${t('space-4')};text-wrap:balance}
${R}.fls-site>.fls-site-head h2 em{font-style:italic;color:${t('accent')}}
${R} .fls-site-copy{display:flex;flex-direction:column;gap:${t('space-4')};font-size:${t('text-md')};color:${t('fg-muted')};max-width:52ch}
${R} .fls-site-copy strong{color:${t('fg')};font-weight:500}
${R} .fls-frame{position:relative;padding:${t('space-5')};border-radius:calc(${t('radius-lg')} + 6px);border:1px solid ${t('border')};background:${t('bg')};box-shadow:${t('elev-2')}}
${R} .fls-frame-label{display:flex;align-items:center;justify-content:space-between;gap:${t('space-4')};margin:0 0 ${t('space-4')};padding:0 ${t('space-2')}}
${R} .fls-seg-cue{display:none;font-size:${t('text-2xs')};color:${t('fg-muted')};margin-top:${t('space-2')}}
@container fls (max-width: 560px){
  ${R} .fls-panel-head:has(.fls-seg){flex-direction:column;align-items:stretch}
  ${R} .fls-seg{-webkit-mask-image:linear-gradient(90deg,currentColor calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,currentColor calc(100% - 40px),transparent);padding-right:40px}
  ${R} .fls-seg button{scroll-snap-align:start}
  ${R} .fls-seg-cue{display:block}
  ${R} .fls-xaxis span[data-alt]{display:none}
}
@container fls (max-width: 520px){
  ${R} .fls-panel{padding:${t('space-5')}}
  ${R} .fls-kpi{padding:${t('space-4')} ${t('space-5')} ${t('space-5')}}
  ${R} .fls-frame{padding:${t('space-3')}}
  ${R}.fls-site{padding:${t('space-8')} ${t('space-5')}}
  ${R} .fls-title{font-size:${t('text-xl')}}
  ${R} .fls-lede{font-size:${t('text-md')}}
  ${R} .fls-hero{padding:${t('space-5')}}
}
@media (prefers-reduced-motion: reduce){
  ${R} *,${R} *::before,${R} *::after{animation:none!important;transition:none!important}
}
@media (forced-colors: active){
  ${R} .fls-bar,${R} .fls-rank-track>span,${R} .fls-mix-bar>span{background:CanvasText}
}
`;

/** Model identity color. Known families map to --fl-model-*; others get a stable series slot by hash. */
const OTHER_SLOTS: Token[] = ['series-4', 'series-5', 'series-7', 'series-8', 'series-3'];
export function modelColor(key: string): string {
  const k = key.toLowerCase();
  for (const fam of ['opus', 'sonnet', 'haiku', 'fable', 'astra'] as const) {
    if (k.includes(fam)) return t(`model-${fam}`);
  }
  if (k === 'other' || k === 'unknown' || k === '') return t('model-unknown');
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return t(OTHER_SLOTS[h % OTHER_SLOTS.length]!);
}

/** Model mix: the top model leads with the accent; the rest step down a neutral ink ramp (fixed order). */
const INK_STEPS = [64, 48, 36, 27, 20];
export function mixColor(i: number): string {
  if (i === 0) return t('accent');
  const p = INK_STEPS[Math.min(i - 1, INK_STEPS.length - 1)]!;
  return `color-mix(in srgb, ${t('fg')} ${p}%, ${t('surface-1')})`;
}
