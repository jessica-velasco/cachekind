const tag = process.env.npm_config_tag

if (tag !== 'alpha') {
  console.error(
    'Refusing to publish Cachekind without the alpha distribution tag. Use: npm publish --tag alpha',
  )
  process.exit(1)
}

console.log('Publish tag verified: alpha')
