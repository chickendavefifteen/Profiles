const MAX_BYTES=10*1024*1024;
export async function fetchDocumentSource(raw){
  let url;
  try{url=new URL(raw);}catch{throw Object.assign(new Error('Use a valid HTTP or HTTPS document link.'),{status:400});}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)
    throw Object.assign(new Error('Document links must use HTTP/HTTPS without embedded credentials.'),{status:400});
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'follow'});
  if(!response.ok) throw Object.assign(new Error('Document server returned HTTP '+response.status+'.'),{status:502});
  if(Number(response.headers.get('content-length'))>MAX_BYTES){
    await response.body?.cancel();
    throw Object.assign(new Error('Document exceeds the 10 MiB reading limit.'),{status:413});
  }
  const chunks=[];let size=0;
  if(response.body){
    const reader=response.body.getReader();
    try{
      for(;;){
        const {value,done}=await reader.read(); if(done) break;
        size+=value.byteLength;
        if(size>MAX_BYTES){await reader.cancel();throw Object.assign(new Error('Document exceeds the 10 MiB reading limit.'),{status:413});}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
  }
  return {bytes:Buffer.concat(chunks,size),contentType:response.headers.get('content-type')||'',url:response.url};
}
