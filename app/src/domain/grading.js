function normVal(v){
  if(v===null||v===undefined)return null;
  if(typeof v==='number'){if(!isFinite(v))return String(v);return Math.round(v*100)/100}
  return String(v).trim();
}
function resultRows(res){
  if(!res||!res.length||!res[0].columns)return null;
  return {cols:res[0].columns.length,rows:res[0].values.map(function(r){return r.map(normVal)})};
}
function cmpRows(a,b,orderCols){
  if(!a||!b)return false;
  if(a.cols!==b.cols)return false;
  if(a.rows.length!==b.rows.length)return false;
  function sameBag(ar,br){
    var sa=ar.map(function(r){return JSON.stringify(r)}).sort();
    var sb=br.map(function(r){return JSON.stringify(r)}).sort();
    for(var i=0;i<sa.length;i++){if(sa[i]!==sb[i])return false}
    return true;
  }
  if(!orderCols||!orderCols.length)return sameBag(a.rows,b.rows);
  /* 只检查题目声明的排序列；同一排序键下的并列行允许换序，重复行仍计数。 */
  function key(row){return JSON.stringify(orderCols.map(function(c){return row[c]}))}
  for(var start=0;start<b.rows.length;){
    var end=start+1;
    while(end<b.rows.length&&key(b.rows[end])===key(b.rows[start]))end++;
    if(!sameBag(a.rows.slice(start,end),b.rows.slice(start,end)))return false;
    start=end;
  }
  return true;
}
function runQuery(db,sql){return db.exec(sql)}


export { normVal, resultRows, cmpRows, runQuery };
