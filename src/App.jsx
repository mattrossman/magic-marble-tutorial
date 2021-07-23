import { useRef, Suspense, useState, useLayoutEffect, useEffect } from 'react'
import { Sphere, OrbitControls, Box, useTexture, Environment } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import * as ShaderUtils from './ShaderUtils'
import * as THREE from 'three'
import { useControls } from 'leva'
import { a as aW, useSpring as useSpringWeb } from '@react-spring/web'
import { a as a3, useSpring as useSpringThree } from '@react-spring/three'

// HSL values
const options = [
  [0, 100, 50],
  [60, 100, 50],
  [150, 100, 50],
  [240, 70, 60],
  [0, 0, 80],
]

export default function App() {
  const [step, setStep] = useState(0)
  const { hsl } = useSpringWeb({
    hsl: options[step % options.length],
    config: { tension: 50 },
  })
  const springyGradient = hsl.to((h, s, l) => `radial-gradient(hsl(${h}, ${s * 0.7}%, ${l}%), hsl(${h},${s * 0.4}%, ${l * 0.2}%))`)
  const [tap, setTap] = useState(false)
  return (
    <aW.div style={{ background: springyGradient, width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 2.5] }}>
        <Suspense fallback={null}>
          <OrbitControls autoRotate enableRotate={false} enablePan={false} enableZoom={false} />
          <Marble tap={tap} step={step} setStep={setStep} />
          <Environment preset="warehouse" />
          <Box scale={100} onPointerDown={() => setTap(true)} onPointerUp={() => setTap(false)}>
            <meshBasicMaterial side={THREE.BackSide} visible={false} />
          </Box>
        </Suspense>
      </Canvas>
    </aW.div>
  )
}

function Marble({ tap, step, setStep }) {
  const matProps = useControls({
    roughness: { value: 0.1, min: 0, max: 1 },
    metalness: { value: 0, min: 0, max: 1 },
    envMapIntensity: { value: 1, min: 0, max: 1 },
  })
  const ref = useRef()
  useFrame(({ clock }) => {
    // ref.current.rotation.y = clock.elapsedTime * 0.2
  })
  const [hover, setHover] = useState(false)
  const { scale } = useSpringThree({
    scale: hover ? (tap ? 1.05 : 1.1) : 1,
    config: {
      friction: 15,
      tension: 300,
    },
  })
  return (
    <a3.group scale={scale} onPointerEnter={() => setHover(true)} onPointerOut={() => setHover(false)} onClick={() => setStep(step + 1)}>
      <Sphere args={[1, 64, 32]} ref={ref}>
        <MagicMarbleMaterial step={step} modelRef={ref} {...matProps} />
      </Sphere>
    </a3.group>
  )
}

function MagicMarbleMaterial({ step, modelRef, ...props }) {
  const noiseMap = useTexture('noise.jpg')
  const displacementMap = useTexture('displacement.jpg')
  noiseMap.minFilter = displacementMap.minFilter = THREE.NearestFilter
  noiseMap.wrapS = noiseMap.wrapT = THREE.RepeatWrapping
  displacementMap.wrapS = displacementMap.wrapT = THREE.RepeatWrapping
  const [uniforms] = useState(() => ({
    time: { value: 0 },
    colorA: { value: new THREE.Color(0, 0, 0) },
    colorB: { value: new THREE.Color(1, 0, 0) },
    worldToLocal: { value: new THREE.Matrix4() },
    noiseMap: { value: noiseMap },
    displacementMap: { value: displacementMap },
    iterations: { value: null },
    maxDepth: { value: null },
    smoothing: { value: null },
    refraction: { value: null },
    displacementStrength: { value: 0.02 },
  }))
  uniforms.noiseMap.value = noiseMap
  uniforms.displacementMap.value = displacementMap
  const { timeOffset } = useSpringThree({
    hsl: options[step % options.length],
    timeOffset: step * 0.2,
    config: { tension: 50 },
    onChange: ({ value: { hsl } }) => {
      const [h, s, l] = hsl
      uniforms.colorB.value.setHSL(h / 360, s / 100, l / 100)
    },
  })
  useFrame(({ clock }) => {
    uniforms.time.value = timeOffset.get() + clock.elapsedTime * 0.05
    modelRef.current.updateMatrixWorld()
    uniforms.worldToLocal.value.copy(modelRef.current.matrixWorld).invert()
  })
  useControls({
    iterations: { value: 64, step: 1, min: 0, onChange: (v) => (uniforms.iterations.value = v) },
    maxDepth: { value: 0.8, min: 0, max: 1, onChange: (v) => (uniforms.maxDepth.value = v) },
    smoothing: { value: 0.1, min: 0, max: 1, onChange: (v) => (uniforms.smoothing.value = v) },
    refraction: { value: 0.5, min: 0, max: 1, onChange: (v) => (uniforms.refraction.value = v) },
    displacementStrength: { value: 0.02, min: 0, max: 0.1, onChange: (v) => (uniforms.displacementStrength.value = v) },
  })

  const onBeforeCompile = (shader) => {
    // Inject uniforms
    ShaderUtils.mergeUniforms(shader, uniforms)

    // Assuming sphere geometry
    ShaderUtils.vertHead(
      shader,
      /* glsl */ `
      uniform mat4 worldToLocal;

      varying vec3 v_pos;
      varying vec3 v_dir;
    `
    )
    ShaderUtils.vertBody(
      shader,
      /* glsl */ `
      vec3 cameraPositionLocal = (worldToLocal * vec4(cameraPosition, 1.0)).xyz;
      v_dir = position - cameraPositionLocal; // Local vec from camera to vert
      v_pos = position;
    `
    )

    ShaderUtils.fragHead(
      shader,
      /* glsl */ `
      uniform float time;
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform sampler2D noiseMap;
      uniform sampler2D displacementMap;
      uniform int iterations;
      uniform float maxDepth;
      uniform float smoothing;
      uniform float refraction;
      uniform float displacementStrength;

      varying vec3 v_pos;
      varying vec3 v_dir;

      /**
       * @param {vec3} p - 3D position
       * @returns {vec2} UV coordinate on a unit sphere 
       */
      vec2 uvSphere(vec3 p) {
        vec3 pn = normalize(p);
        float u = 0.5 - atan(pn.z, pn.x) / (2. * 3.1415926);
        float v = 0.5 + asin(pn.y) / 3.1415926;
        return vec2(u, v);
      }

      /**
       * Note: we assume a unit sphere
       * 
       * @param {vec3} rayOrigin - Point on sphere
       * @param {vec3} rayDir - Normalized view direction
       * @returns {vec3} Accumulated RGB color
       */
      vec3 marchMarble(vec3 rayOrigin, vec3 rayDir) {
        float perIteration = 1. / float(iterations);
        vec3 deltaRay = rayDir * perIteration * maxDepth;
        float c = 0.;

        // Start at point of intersection
        vec3 p = rayOrigin;

        for (int i=0; i<iterations; ++i) {
          vec2 uv = uvSphere(p);
          vec3 displacementA = texture(displacementMap, uv + vec2(time, 0.)).rgb * 2. - 1.;
          vec3 displacementB = texture(displacementMap, vec2(uv.x, -uv.y) - vec2(time, 0.)).rgb * 2. - 1.;
          uv = uvSphere(p + (displacementA + displacementB) * displacementStrength);
          float noiseVal = texture(noiseMap, uv).r;
          float height = length(p); // 1 at surface, 0 at core
          float cutoff = 1. - float(i) * perIteration;
          float mask = smoothstep(cutoff, cutoff + smoothing, noiseVal);
          c += mask * perIteration;
          p += deltaRay;
        }
        return mix(colorA, colorB, c);
      }
      `
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      /vec4 diffuseColor.*;/,
      /* glsl */ `
        vec3 rayOrigin = normalize(v_pos);
        vec3 norm = -rayOrigin;
        
        vec3 rayDir = normalize(v_dir);
        rayDir = mix(rayDir, norm, refraction);
        rayDir = normalize(rayDir);

        vec3 rgb = marchMarble(rayOrigin, rayDir);
        vec4 diffuseColor = vec4( rgb, opacity);
      `
    )
  }

  return (
    <meshStandardMaterial
      {...props}
      onBeforeCompile={onBeforeCompile}
      onUpdate={(m) => (m.needsUpdate = true)}
      customProgramCacheKey={() => onBeforeCompile.toString()}
    />
  )
}
