/** Structural limit before JSON.parse; braces within JSON strings do not count. */
export function requireJsonDepth(text,maximum=64){
  let depth=0,quoted=false,escaped=false;
  for(const char of text){
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
    else if(char==='"')quoted=true;
    else if(char==='['||char==='{'){if(++depth>maximum)throw Object.assign(Error('JSON nesting limit exceeded'),{status:400});}
    else if(char===']'||char==='}')depth--;
  }
}
