import { LayerExtension } from '@deck.gl/core';
import type { Layer, LayerContext, Accessor } from '@deck.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';

/**
 * Adds a traveling "comet head" pulse along an ArcLayer's arcs, direction
 * controlled per-instance by `getFlowSign` (+1 = travels source->target,
 * -1 = target->source, 0 = no pulse). Driven entirely by a uniform
 * (`flowTime`), so cost stays flat regardless of arc count — no per-instance
 * CPU work runs on each animation tick, only a fragment-shader blend.
 */

type ArcFlowModuleProps = {
  flowTime?: number;
  flowSpeed?: number;
  flowWidth?: number;
};

type ArcFlowModuleUniforms = {
  time?: number;
  speed?: number;
  width?: number;
};

const uniformBlock = /* glsl */ `\
uniform arcFlowUniforms {
  float time;
  float speed;
  float width;
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
      float bandPos = fract(arcFlow.time * arcFlow.speed);
      float d = abs(localT - bandPos);
      d = min(d, 1.0 - d);
      float pulse = 1.0 - smoothstep(0.0, arcFlow.width, d);
      color.rgb = mix(color.rgb, vec3(1.0), pulse * 0.85);
      color.a = clamp(color.a + pulse * 0.55, 0.0, 1.0);
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
    const { flowTime = 0, flowSpeed = 0.8, flowWidth = 0.16 } = opts as ArcFlowModuleProps;
    return { time: flowTime, speed: flowSpeed, width: flowWidth };
  },
  uniformTypes: {
    time: 'f32',
    speed: 'f32',
    width: 'f32',
  },
} as ShaderModule<ArcFlowModuleProps, ArcFlowModuleUniforms>;

const defaultProps = {
  getFlowSign: { type: 'accessor', value: 0 },
  flowTime: { type: 'number', value: 0 },
  flowSpeed: { type: 'number', value: 0.8 },
  flowWidth: { type: 'number', value: 0.16 },
};

export type ArcFlowExtensionProps<DataT = unknown> = {
  getFlowSign?: Accessor<DataT, number>;
  flowTime?: number;
  flowSpeed?: number;
  flowWidth?: number;
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
    const { flowTime, flowSpeed, flowWidth } = this.props;
    this.setShaderModuleProps({ arcFlow: { flowTime, flowSpeed, flowWidth } });
  }
}
