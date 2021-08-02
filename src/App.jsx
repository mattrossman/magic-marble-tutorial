import { Suspense, useState } from 'react'
import { Sphere, OrbitControls, Box, useTexture, Environment } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { a as aw, useSpring as useSpringWeb } from '@react-spring/web'
import { a as a3, useSpring as useSpringThree } from '@react-spring/three'
import * as THREE from 'three'

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
  return (
    <aw.div style={{ background: springyGradient, width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 2] }}>
        <Suspense fallback={null}>
          <OrbitControls autoRotate enableRotate={false} enablePan={false} enableZoom={false} />
          <Marble step={step} setStep={setStep} />
          <Environment preset="warehouse" />
        </Suspense>
      </Canvas>
    </aw.div>
  )
}

function Marble({ step, setStep }) {
  const [hover, setHover] = useState(false)
  const [tap, setTap] = useState(false)
  const { scale } = useSpringThree({
    scale: tap && hover ? 0.95 : 1,
    config: {
      friction: 15,
      tension: 300,
    },
  })
  return (
    <group>
      <a3.group scale={scale} onPointerEnter={() => setHover(true)} onPointerOut={() => setHover(false)} onClick={() => setStep(step + 1)}>
        <Sphere args={[1, 64, 32]}>
          <MagicMarbleMaterial step={step} roughness={0.1} />
        </Sphere>
      </a3.group>
      {/* This big invisible box is just a pointer target so we can reliably track if the mouse button is up or down */}
      <Box args={[100, 100, 100]} onPointerDown={() => setTap(true)} onPointerUp={() => setTap(false)}>
        <meshBasicMaterial side={THREE.BackSide} visible={false} />
      </Box>
    </group>
  )
}

/**
 * @typedef MagicMarbleMaterialProps
 * @property {number} step - Which step of the color sequence we're on
 *
 * @param {MagicMarbleMaterialProps & THREE.MeshStandardMaterialParameters}
 */
function MagicMarbleMaterial({ step, ...props }) {
  // Load the noise textures
  const heightMap = useTexture('noise.jpg')
  const displacementMap = useTexture('noise3D.jpg')
  heightMap.minFilter = displacementMap.minFilter = THREE.NearestFilter
  displacementMap.wrapS = displacementMap.wrapT = THREE.RepeatWrapping

  // Create persistent local uniforms object
  const [uniforms] = useState(() => ({
    time: { value: 0 },
    colorA: { value: new THREE.Color(0, 0, 0) },
    colorB: { value: new THREE.Color(1, 0, 0) },
    heightMap: { value: heightMap },
    displacementMap: { value: displacementMap },
    iterations: { value: 48 },
    depth: { value: 0.6 },
    smoothing: { value: 0.2 },
    displacement: { value: 0.1 },
  }))

  // This spring value allows us to "fast forward" the displacement in the marble
  const { timeOffset } = useSpringThree({
    hsl: options[step % options.length],
    timeOffset: step * 0.2,
    config: { tension: 50 },
    onChange: ({ value: { hsl } }) => {
      const [h, s, l] = hsl
      uniforms.colorB.value.setHSL(h / 360, s / 100, l / 100)
    },
  })

  // Update time uniform on each frame
  useFrame(({ clock }) => {
    uniforms.time.value = timeOffset.get() + clock.elapsedTime * 0.05
  })

  // Add our custom bits to the MeshStandardMaterial
  const onBeforeCompile = (shader) => {
    // Wire up local uniform references
    shader.uniforms = { ...shader.uniforms, ...uniforms }

    // Add to top of vertex shader
    shader.vertexShader =
      /* glsl */ `
      varying vec3 v_pos;
      varying vec3 v_dir;
    ` + shader.vertexShader

    // Assign values to varyings inside of main()
    shader.vertexShader = shader.vertexShader.replace(
      /void main\(\) {/,
      (match) =>
        match +
        /* glsl */ `
        v_dir = position - cameraPosition; // Points from camera to vertex
        v_pos = position;
        `
    )

    // Add to top of fragment shader
    shader.fragmentShader =
      /* glsl */ `
      #define FLIP vec2(1., -1.)
      
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform sampler2D heightMap;
      uniform sampler2D displacementMap;
      uniform int iterations;
      uniform float depth;
      uniform float smoothing;
      uniform float displacement;
      uniform float time;
      
      varying vec3 v_pos;
      varying vec3 v_dir;
    ` + shader.fragmentShader

    // Add above fragment shader main() so we can access common.glsl.js
    shader.fragmentShader = shader.fragmentShader.replace(
      /void main\(\) {/,
      (match) =>
        /* glsl */ `
       	/**
         * @param p - Point to displace
         * @param strength - How much the map can displace the point
         * @returns Point with scrolling displacement applied
         */
        vec3 displacePoint(vec3 p, float strength) {
        	vec2 uv = equirectUv(normalize(p));
          vec2 scroll = vec2(time, 0.);
          vec3 displacementA = texture(displacementMap, uv + scroll).rgb; // Upright
					vec3 displacementB = texture(displacementMap, uv * FLIP - scroll).rgb; // Upside down
          
          // Center the range to [-0.5, 0.5], note the range of their sum is [-1, 1]
          displacementA -= 0.5;
          displacementB -= 0.5;
          
          return p + strength * (displacementA + displacementB);
        }
        
				/**
          * @param rayOrigin - Point on sphere
          * @param rayDir - Normalized ray direction
          * @returns Diffuse RGB color
          */
        vec3 marchMarble(vec3 rayOrigin, vec3 rayDir) {
          float perIteration = 1. / float(iterations);
          vec3 deltaRay = rayDir * perIteration * depth;

          // Start at point of intersection and accumulate volume
          vec3 p = rayOrigin;
          float totalVolume = 0.;

          for (int i=0; i<iterations; ++i) {
            // Read heightmap from spherical direction of displaced ray position
            vec3 displaced = displacePoint(p, displacement);
            vec2 uv = equirectUv(normalize(displaced));
            float heightMapVal = texture(heightMap, uv).r;

            // Take a slice of the heightmap
            float height = length(p); // 1 at surface, 0 at core, assuming radius = 1
            float cutoff = 1. - float(i) * perIteration;
            float slice = smoothstep(cutoff, cutoff + smoothing, heightMapVal);

            // Accumulate the volume and advance the ray forward one step
            totalVolume += slice * perIteration;
            p += deltaRay;
          }
          return mix(colorA, colorB, totalVolume);
        }
      ` + match
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      /vec4 diffuseColor.*;/,
      /* glsl */ `
      vec3 rayDir = normalize(v_dir);
      vec3 rayOrigin = v_pos;
      
      vec3 rgb = marchMarble(rayOrigin, rayDir);
      vec4 diffuseColor = vec4(rgb, 1.);      
      `
    )
  }

  return (
    <meshStandardMaterial
      {...props}
      onBeforeCompile={onBeforeCompile}
      // The following props allow React hot-reload to work with the onBeforeCompile argument
      onUpdate={(m) => (m.needsUpdate = true)}
      customProgramCacheKey={() => onBeforeCompile.toString()}
    />
  )
}
