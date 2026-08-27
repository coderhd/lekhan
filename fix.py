with open('lib/crypto.ts', 'r') as f:
    text = f.read()

text = text.replace('		ciphertext\n	)', '		ciphertext as BufferSource\n	)')

with open('lib/crypto.ts', 'w') as f:
    f.write(text)
