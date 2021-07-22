export const fragHead = (shader, head) => {
  shader.fragmentShader = head + '\n' + shader.fragmentShader
}
export const vertHead = (shader, head) => {
  shader.vertexShader = head + '\n' + shader.vertexShader
}
export const fragBody = (shader, body) => {
  shader.fragmentShader = shader.fragmentShader.replace(/void main\(\) {/, (head) => head + body)
}
export const vertBody = (shader, body) => {
  shader.vertexShader = shader.vertexShader.replace(/void main\(\) {/, (head) => head + body)
}
export const mergeUniforms = (shader, uniforms) => {
  shader.uniforms = { ...shader.uniforms, ...uniforms }
}
