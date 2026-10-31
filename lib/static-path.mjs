import path from 'node:path';
export function publicAssetPath(root,pathname,paths=path){
  let decoded;
  try{decoded=decodeURIComponent(pathname);}catch{throw Object.assign(Error('Malformed asset path'),{status:400});}
  if(decoded.includes('\0')||decoded.includes('\\'))throw Object.assign(Error('Malformed asset path'),{status:400});
  const base=paths.resolve(root),file=paths.resolve(base,'.'+decoded),relative=paths.relative(base,file);
  if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw Object.assign(Error('Invalid asset path'),{status:403});
  return file;
}
