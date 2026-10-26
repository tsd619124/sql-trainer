function genSyncCode(){
  var a=new Uint8Array(16);
  if(typeof crypto!=='undefined'&&crypto.getRandomValues)crypto.getRandomValues(a);
  else for(var i=0;i<16;i++)a[i]=Math.floor(Math.random()*256);
  var s='';for(var j=0;j<16;j++)s+=String.fromCharCode(a[j]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export { genSyncCode };
