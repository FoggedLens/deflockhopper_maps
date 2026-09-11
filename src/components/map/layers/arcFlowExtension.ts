import { LayerExtension } from '@deck.gl/core';
import type { Layer, LayerContext, Accessor } from '@deck.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

/**
 * Adds a slow-moving dotted "pipeline" pattern along an ArcLayer's arcs —
 * a handful of evenly spaced dots drifting from source to target (direction
 * per-instance via `getFlowSign`: +1 = source->target, -1 = target->source,
 * 0 = no dots). Driven entirely by a uniform (`flowTime`), so cost stays flat
 * regardless of arc count — no per-instance CPU work runs on each animation
 * tick, only a fragment-shader blend.
 */

type ArcFlowModuleProps = {
  flowTime?: number;
  flowSpeed?: number;
  flowWidth?: number;
  flowDashCount?: number;
};

type ArcFlowModuleUniforms = {
  time?: number;
  speed?: number;
  width?: number;
  dashCount?: number;
};

const uniformBlock = /* glsl */ `\
uniform arcFlowUniforms {
  float time;
  float speed;
  float width;
  float dashCount;
} arcFlow;
`;

const vs = /* glsl */ `
${uniformBlock}
in float instanceFlowSigns;
out float arcFlow_sign;
`;

const fs = /* glsl */ `
${uniformBlock}
in float arcFlow_sign;
`;

const inject = {
  'vs:DECKGL_FILTER_COLOR': /* glsl */ `
    arcFlow_sign = instanceFlowSigns;
  `,
  'fs:DECKGL_FILTER_COLOR': /* glsl */ `
    if (arcFlow_sign != 0.0) {
      float localT = arcFlow_sign > 0.0 ? geometry.uv.x : 1.0 - geometry.uv.x;
      float period = 1.0 / arcFlow.dashCount;
      float phase = fract(localT / period - arcFlow.time * arcFlow.speed);
      float distFromDot = min(phase, 1.0 - phase);
      float dot = 1.0 - smoothstep(0.0, arcFlow.width, distFromDot);
      color.rgb = mix(color.rgb, vec3(1.0), dot * 0.7);
      color.a = clamp(color.a + dot * 0.4, 0.0, 1.0);
    }
  `,
};

const arcFlowShaderModule = {
  name: 'arcFlow',
  vs,
  fs,
  inject,
  getUniforms: (opts?: ArcFlowModuleProps | Record<string, never>): ArcFlowModuleUniforms => {
    if (!opts || !('flowTime' in opts)) return {};
    const { flowTime = 0, flowSpeed = 0.5, flowWidth = 0.15, flowDashCount = 5 } = opts as ArcFlowModuleProps;
    return { time: flowTime, speed: flowSpeed, width: flowWidth, dashCount: flowDashCount };
  },
  uniformTypes: {
    time: 'f32',
    speed: 'f32',
    width: 'f32',
    dashCount: 'f32',
  },
} as ShaderModule<ArcFlowModuleProps, ArcFlowModuleUniforms>;

const defaultProps = {
  getFlowSign: { type: 'accessor', value: 0 },
  flowTime: { type: 'number', value: 0 },
  // speed is in dash-periods/sec; actual travel speed along the arc is
  // speed / dashCount (arc-lengths/sec) — ~0.1 here, roughly 10s edge-to-edge.
  flowSpeed: { type: 'number', value: 0.5 },
  // dot half-width as a fraction of the spacing between dots — small relative
  // to the gap so dots read as separate, not a solid moving band.
  flowWidth: { type: 'number', value: 0.15 },
  flowDashCount: { type: 'number', value: 5 },
};

export type ArcFlowExtensionProps<DataT = unknown> = {
  getFlowSign?: Accessor<DataT, number>;
  flowTime?: number;
  flowSpeed?: number;
  flowWidth?: number;
  flowDashCount?: number;
};

export class ArcFlowExtension extends LayerExtension {
  static defaultProps = defaultProps;
  static extensionName = 'ArcFlowExtension';

  getShaders() {
    return { modules: [arcFlowShaderModule] };
  }

  initializeState(this: Layer<ArcFlowExtensionProps>, _context: LayerContext, _extension: this) {
    const attributeManager = this.getAttributeManager();
    attributeManager?.add({
      instanceFlowSigns: {
        size: 1,
        stepMode: 'dynamic',
        accessor: 'getFlowSign',
        defaultValue: 0,
      },
    });
  }

  draw(this: Layer<ArcFlowExtensionProps>, _params: unknown, _extension: this) {
    const { flowTime, flowSpeed, flowWidth, flowDashCount } = this.props;
    this.setShaderModuleProps({ arcFlow: { flowTime, flowSpeed, flowWidth, flowDashCount } });
  }
}
