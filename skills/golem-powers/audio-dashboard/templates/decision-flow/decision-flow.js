(function(){
  var root=document.documentElement;
  var cards=Array.from(document.querySelectorAll(".df-card"));
  var KEY=document.body.dataset.storageKey||"dbx:decision-flow";
  var storageState=document.getElementById("df-storage-state");
  var store={};
  try{store=JSON.parse(localStorage.getItem(KEY)||"{}");}catch(error){store={};}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(store));storageState.textContent="Answers saved locally.";storageState.classList.remove("is-error");}catch(error){storageState.textContent="Storage unavailable · use Copy answers";storageState.classList.add("is-error");}updateCounts();}
  function answered(card){var id=card.dataset.decision;return Boolean(store[id]||String(store[id+"-free"]||"").trim());}
  function updateCounts(){var count=cards.filter(answered).length;document.getElementById("df-answered").textContent=String(count);document.getElementById("df-remaining").textContent=String(cards.length-count);}
  function audiosFor(card){return Array.from(card.querySelectorAll("audio[data-audio-scene]"));}
  function clearHighlights(card,sceneId){var selector=sceneId?'.df-word[data-scene="'+sceneId+'"]':".df-word";card.querySelectorAll(selector).forEach(function(word){word.classList.remove("is-current");});}
  function resetHighlights(card){card.querySelectorAll(".df-word").forEach(function(word){word.classList.remove("is-current","is-read");});}
  function pauseCard(card,label,collapseTeleprompter){var playing=audiosFor(card).find(function(audio){return !audio.paused;});if(playing)playing.pause();card.classList.remove("is-playing");card.classList.add("is-paused");card.querySelector(".df-play").textContent="▶ Resume full section";card.querySelector(".df-player-state").textContent=label||"Paused · resume where you left off";if(collapseTeleprompter)card.querySelector(".df-teleprompter").hidden=true;}
  function stopOtherCards(except){cards.forEach(function(card){if(card!==except&&audiosFor(card).some(function(audio){return !audio.paused;}))pauseCard(card,"Paused · another decision is playing",true);});}
  function completeCard(card){audiosFor(card).forEach(function(audio){audio.pause();});clearHighlights(card);card.dataset.audioIndex=String(audiosFor(card).length);card.classList.remove("is-playing","is-paused");card.querySelector(".df-play").textContent="↻ Play again";card.querySelector(".df-player-state").textContent="Complete · ready to answer";card.querySelector(".df-teleprompter").hidden=true;}
  function setHighlight(card,sceneId,time){var words=Array.from(card.querySelectorAll('.df-word[data-scene="'+sceneId+'"]'));var current=-1;words.forEach(function(word,index){if(time>=Number(word.dataset.wordStart)-0.04)current=index;});words.forEach(function(word,index){word.classList.toggle("is-read",index<current);word.classList.toggle("is-current",index===current);});if(current>=0)words[current].scrollIntoView({block:"nearest"});}
  function playAt(card,index){
    var audios=audiosFor(card);if(index>=audios.length){completeCard(card);return;}
    stopOtherCards(card);audios.forEach(function(audio,audioIndex){if(audioIndex!==index){audio.pause();audio.currentTime=0;}});
    card.dataset.audioIndex=String(index);card.querySelector(".df-teleprompter").hidden=false;card.classList.add("is-playing");card.classList.remove("is-paused");card.querySelector(".df-play").textContent="⏸ Pause";card.querySelector(".df-player-state").textContent="Playing "+(index+1)+" of "+audios.length;
    audios[index].play().catch(function(error){if(error&&error.name==="AbortError")return;card.classList.remove("is-playing");card.classList.add("is-paused");card.querySelector(".df-play").textContent="▶ Resume full section";card.querySelector(".df-player-state").textContent=error&&error.name==="NotAllowedError"?"Tap play again to allow audio":"Playback failed · try again";});
  }
  function playCard(card,forcePlay){var audios=audiosFor(card);var playing=audios.find(function(audio){return !audio.paused;});if(playing){if(forcePlay)return;pauseCard(card);return;}var index=Number(card.dataset.audioIndex||0);if(index>=audios.length){audios.forEach(function(audio){audio.currentTime=0;});resetHighlights(card);index=0;}playAt(card,index);}
  function restartCard(card){audiosFor(card).forEach(function(audio){audio.pause();audio.currentTime=0;});resetHighlights(card);card.dataset.audioIndex="0";playAt(card,0);}
  function activate(index,autoplay){if(index>=cards.length)return;cards.forEach(function(card,i){card.classList.toggle("is-active",i===index);});cards[index].scrollIntoView({behavior:"smooth",block:"start"});cards[index].querySelector(".df-play").focus({preventScroll:true});if(autoplay)playCard(cards[index],true);}
  cards.forEach(function(card,index){
    var audios=audiosFor(card);
    audios.forEach(function(audio,audioIndex){audio.onended=function(){clearHighlights(card,audio.dataset.audioScene);playAt(card,audioIndex+1);};audio.ontimeupdate=function(){setHighlight(card,audio.dataset.audioScene,audio.currentTime);};});
    card.querySelector(".df-play").addEventListener("click",function(){playCard(card);});
    card.querySelector(".df-restart").addEventListener("click",function(){restartCard(card);});
    card.querySelectorAll(".df-word").forEach(function(word){word.addEventListener("click",function(){var audioIndex=audios.findIndex(function(item){return item.dataset.audioScene===word.dataset.scene;});if(audioIndex<0)return;audios.forEach(function(audio,indexToReset){audio.pause();if(indexToReset>audioIndex){audio.currentTime=0;card.querySelectorAll('.df-word[data-scene="'+audio.dataset.audioScene+'"]').forEach(function(laterWord){laterWord.classList.remove("is-current","is-read");});}});clearHighlights(card);card.dataset.audioIndex=String(audioIndex);audios[audioIndex].currentTime=Number(word.dataset.wordStart);playAt(card,audioIndex);});});
    card.querySelectorAll('input[type="radio"]').forEach(function(input){if(store[input.name]===input.value)input.checked=true;input.addEventListener("change",function(){store[input.name]=input.value;persist();});});
    var free=card.querySelector(".df-free");if(store[free.dataset.note])free.value=store[free.dataset.note];free.addEventListener("input",function(){store[free.dataset.note]=free.value;persist();});
    card.querySelector(".df-next").addEventListener("click",function(){var button=this;if(cards[index+1]){activate(index+1,true);return;}var copy=document.getElementById("df-copy");button.classList.add("is-acknowledged");button.textContent="All decisions reviewed → Copy answers";copy.scrollIntoView({behavior:"smooth",block:"center"});copy.focus({preventScroll:true});});
    card.querySelector(".df-skip").addEventListener("click",function(){var button=this;var nextCard=cards[index+1];button.classList.add("is-acknowledged");button.textContent=nextCard?"Skipped · moving on…":"Skipped";if(!nextCard)return;playCard(nextCard,true);setTimeout(function(){activate(index+1,false);},220);});
  });
  function answersText(){var lines=["## Decision answers - "+KEY.replace(/^dbx:/,"")];cards.forEach(function(card){var id=card.dataset.decision;lines.push("### "+card.dataset.title);lines.push("- picked: "+(store[id]||"(no option picked)"));if(store[id+"-free"])lines.push("- in your words: "+store[id+"-free"]);});return lines.join("\n");}
  function copied(){var state=document.getElementById("df-copy-state");state.textContent="Answers copied";state.classList.add("is-visible");setTimeout(function(){state.classList.remove("is-visible");},1200);}
  document.getElementById("df-copy").addEventListener("click",function(){var text=answersText();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(copied,function(){fallback(text);});}else fallback(text);});
  function fallback(text){var area=document.createElement("textarea");area.value=text;document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();copied();}
  updateCounts();root.dataset.ready="true";
})();
