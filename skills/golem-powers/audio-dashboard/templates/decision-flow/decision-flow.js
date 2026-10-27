(function(){
  /* State model (one concern each):
     card playback  idle -> playing <-> paused -> complete -> playing; one card plays at a time.
     current card   exactly one .is-active card; chips, transport prev/next and card Next/Skip move it,
                    and a move while audio plays hands playback to the new card (nothing plays hidden).
     preferences    rate (one of RATES) and view (list|story), persisted in the dashboard's own store.
     answer sheet   closed -> open (Answer, story view only) -> closed (Done, Esc, backdrop, Next/Skip,
                    another card, list view). Open: dialog role, rest inert, focus trapped; close returns focus. */
  var root=document.documentElement;
  var cards=Array.from(document.querySelectorAll(".df-card"));
  var KEY=document.body.getAttribute("data-storage-key")||"dbx:decision-flow";
  var RATES=[0.8,1,1.25,1.5,1.75,2];
  var storageState=document.getElementById("df-storage-state");
  var transportPrev=document.getElementById("df-transport-prev");
  var transportPlay=document.getElementById("df-transport-play");
  var transportNext=document.getElementById("df-transport-next");
  var nowLabel=document.getElementById("df-now");
  var speed=document.getElementById("df-speed");
  var viewToggle=document.getElementById("df-view-toggle");
  var chipStrip=document.querySelector(".df-chips");
  var transportStop=document.getElementById("df-transport-stop");
  var progressFill=document.getElementById("df-progress-fill");
  var storyCount=document.getElementById("df-story-count");
  var backdrop=document.getElementById("df-sheet-backdrop");
  var totals={};try{var tp=JSON.parse(document.getElementById("tpdata").textContent||"{}");Object.keys(tp).forEach(function(id){totals[id]=Number(tp[id].total)||0;});}catch(error){totals={};}
  var store={};
  try{store=JSON.parse(localStorage.getItem(KEY)||"{}");}catch(error){store={};}
  if(!store||typeof store!=="object")store={};
  var prefs=store._prefs&&typeof store._prefs==="object"?store._prefs:{};
  var rate=RATES.indexOf(Number(prefs.rate))>=0?Number(prefs.rate):1;
  var view=prefs.view==="story"?"story":"list";
  function indexLink(card){return document.querySelector('[data-index-for="'+card.dataset.decision+'"]');}
  function chipFor(card){return document.querySelector('.df-chip[data-chip-for="'+card.dataset.decision+'"]');}
  function revealChip(chip){if(!chipStrip||!chip)return;var left=chip.offsetLeft,right=left+chip.offsetWidth;if(left<chipStrip.scrollLeft)chipStrip.scrollLeft=Math.max(0,left-12);else if(right>chipStrip.scrollLeft+chipStrip.clientWidth)chipStrip.scrollLeft=right-chipStrip.clientWidth+12;}
  function markIndex(card,name,on){var link=indexLink(card);if(link)link.classList.toggle(name,on);var chip=chipFor(card);if(!chip)return;chip.classList.toggle(name,on);if(name==="is-active"){if(on){chip.setAttribute("aria-current","true");revealChip(chip);}else chip.removeAttribute("aria-current");}}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(store));storageState.textContent="Answers saved locally.";storageState.classList.remove("is-error");}catch(error){storageState.textContent="Storage unavailable · use Copy answers";storageState.classList.add("is-error");}updateCounts();}
  function savePrefs(){store._prefs={rate:rate,view:view};persist();}
  function checklistBoxes(card){return Array.from(card.querySelectorAll(".df-checklist .df-check-input"));}
  function checksFor(card){var value=store[card.dataset.decision+"-checks"];return value&&typeof value==="object"?value:{};}
  function checkedCount(card){var checks=checksFor(card);return checklistBoxes(card).filter(function(box){return checks[box.dataset.checkIndex]===true;}).length;}
  function checklistComplete(card){var total=checklistBoxes(card).length;return total>0&&checkedCount(card)===total;}
  function answered(card){var id=card.dataset.decision;return Boolean(store[id]||String(store[id+"-free"]||"").trim()||checklistComplete(card));}
  function updateCounts(){cards.forEach(function(card){var done=answered(card);card.classList.toggle("is-answered",done);if(done){var offer=card.querySelector(".df-answer-open");if(offer)offer.classList.remove("is-offer");}markIndex(card,"is-answered",done);var counter=card.querySelector(".df-checklist-count");if(counter)counter.textContent=checkedCount(card)+" of "+checklistBoxes(card).length+" checked";});var count=cards.filter(answered).length;var fill=document.getElementById("df-meter-fill");if(fill)fill.style.width=(cards.length?count/cards.length*100:0)+"%";document.getElementById("df-answered").textContent=String(count);document.getElementById("df-remaining").textContent=String(cards.length-count);}
  function audiosFor(card){return Array.from(card.querySelectorAll("audio[data-audio-scene]"));}
  function allAudios(){return Array.from(document.querySelectorAll("audio[data-audio-scene]"));}
  function isPlaying(card){return audiosFor(card).some(function(audio){return !audio.paused;});}
  function current(){return cards.find(function(card){return card.classList.contains("is-active");})||cards[0];}
  function updateTransport(){
    if(!transportPlay)return;var card=current();var index=cards.indexOf(card);var audios=audiosFor(card);
    transportPrev.disabled=index<=0;transportNext.disabled=index>=cards.length-1;
    var state=isPlaying(card)?["⏸","Pause"]:card.classList.contains("is-paused")?["▶","Resume"]:Number(card.dataset.audioIndex||0)>=audios.length?["↻","Again"]:["▶","Play"];
    // Icon and word are separate so the phone row can show the icon alone; the word stays in the accessible name.
    transportPlay.innerHTML='<span class="df-tplay-icon" aria-hidden="true">'+state[0]+'</span><span class="df-tplay-text">'+state[1]+'</span>';transportPlay.setAttribute("aria-label",state[1]+" card: "+card.dataset.title);
    var rank=card.querySelector(".df-rank");nowLabel.textContent=(rank?rank.textContent+"  ":"")+card.dataset.title;
    if(storyCount)storyCount.textContent=(index+1)+" / "+cards.length;
    updateProgress(card);
  }
  // Progress through the current card's whole section, across its clips, in media time.
  function updateProgress(card){if(!progressFill||card!==current())return;var audios=audiosFor(card);var total=audios.reduce(function(sum,audio){return sum+(totals[audio.dataset.audioScene]||0);},0);var index=Number(card.dataset.audioIndex||0);var done=0;if(index>=audios.length)done=total;else{audios.slice(0,index).forEach(function(audio){done+=totals[audio.dataset.audioScene]||0;});done+=Number(audios[index].currentTime)||0;}var share=total?Math.min(100,done/total*100):0;progressFill.style.width=(Math.round(share*10)/10)+"%";}
  function applyRate(){allAudios().forEach(function(audio){audio.defaultPlaybackRate=rate;audio.playbackRate=rate;});if(speed)speed.value=String(rate);}
  function applyView(){document.body.dataset.view=view;if(viewToggle)viewToggle.setAttribute("aria-pressed",view==="story"?"true":"false");}
  function clearHighlights(card,sceneId){var selector=sceneId?'.df-word[data-scene="'+sceneId+'"]':".df-word";card.querySelectorAll(selector).forEach(function(word){word.classList.remove("is-current");});}
  function resetHighlights(card){card.querySelectorAll(".df-word").forEach(function(word){word.classList.remove("is-current","is-read");});delete card.dataset.hl;}
  function pauseCard(card,label,collapseTeleprompter){var playing=audiosFor(card).find(function(audio){return !audio.paused;});if(playing)playing.pause();card.classList.remove("is-playing");markIndex(card,"is-playing",false);card.classList.add("is-paused");card.querySelector(".df-play").textContent="▶ Resume full section";card.querySelector(".df-player-state").textContent=label||"Paused · resume where you left off";if(collapseTeleprompter)card.querySelector(".df-teleprompter").hidden=true;updateTransport();}
  function stopOtherCards(except){cards.forEach(function(card){if(card!==except&&isPlaying(card))pauseCard(card,"Paused · another decision is playing",true);});}
  function stopCard(card){audiosFor(card).forEach(function(audio){audio.pause();audio.currentTime=0;});resetHighlights(card);card.dataset.audioIndex="0";card.classList.remove("is-playing","is-paused");markIndex(card,"is-playing",false);card.querySelector(".df-play").textContent="▶ Play full section";card.querySelector(".df-player-state").textContent="Stopped · plays from the start";card.querySelector(".df-teleprompter").hidden=true;updateTransport();}
  function completeCard(card){audiosFor(card).forEach(function(audio){audio.pause();});clearHighlights(card);card.querySelectorAll(".df-word").forEach(function(word){word.classList.add("is-read");});card.dataset.audioIndex=String(audiosFor(card).length);card.classList.remove("is-playing","is-paused");markIndex(card,"is-playing",false);card.querySelector(".df-play").textContent="↻ Play again";card.querySelector(".df-player-state").textContent="Complete · ready to answer";card.querySelector(".df-teleprompter").hidden=true;if(view==="story"&&!answered(card))card.querySelector(".df-answer-open").classList.add("is-offer");updateTransport();}
  // Highlight reads media time (audio.currentTime), so it stays exact at any playback rate.
  function setHighlight(card,sceneId,time){var words=Array.from(card.querySelectorAll('.df-word[data-scene="'+sceneId+'"]'));var current=-1;words.forEach(function(word,index){if(time>=Number(word.dataset.wordStart)-0.04)current=index;});words.forEach(function(word,index){word.classList.toggle("is-read",index<current);word.classList.toggle("is-current",index===current);});var mark=sceneId+":"+current;if(current>=0&&card.dataset.hl!==mark){card.dataset.hl=mark;words[current].scrollIntoView({block:"nearest"});}}
  var frame=typeof requestAnimationFrame==="function"?requestAnimationFrame:null;var ticking=false;
  function tick(){var audio=allAudios().find(function(item){return !item.paused;});if(!audio){ticking=false;return;}setHighlight(audio.closest(".df-card"),audio.dataset.audioScene,audio.currentTime);updateProgress(audio.closest(".df-card"));frame(tick);}
  function startTicking(){if(frame&&!ticking){ticking=true;frame(tick);}}
  function playAt(card,index){
    var audios=audiosFor(card);if(index>=audios.length){completeCard(card);return;}
    stopOtherCards(card);audios.forEach(function(audio,audioIndex){if(audioIndex!==index){audio.pause();audio.currentTime=0;}});
    // Every clip before this one has been heard: its words read as read, last word included.
    audios.slice(0,index).forEach(function(audio){card.querySelectorAll('.df-word[data-scene="'+audio.dataset.audioScene+'"]').forEach(function(word){word.classList.remove("is-current");word.classList.add("is-read");});});
    card.dataset.audioIndex=String(index);setActive(card);markIndex(card,"is-playing",true);card.querySelector(".df-teleprompter").hidden=false;card.classList.add("is-playing");card.classList.remove("is-paused");card.querySelector(".df-play").textContent="⏸ Pause";card.querySelector(".df-player-state").textContent="Playing "+(index+1)+" of "+audios.length;
    audios[index].playbackRate=rate;
    audios[index].play().catch(function(error){if(error&&error.name==="AbortError")return;card.classList.remove("is-playing");markIndex(card,"is-playing",false);card.classList.add("is-paused");card.querySelector(".df-play").textContent="▶ Resume full section";card.querySelector(".df-player-state").textContent=error&&error.name==="NotAllowedError"?"Tap play again to allow audio":"Playback failed · try again";updateTransport();});
    updateTransport();startTicking();
  }
  function playCard(card,forcePlay){var audios=audiosFor(card);var playing=audios.find(function(audio){return !audio.paused;});if(playing){if(forcePlay)return;pauseCard(card);return;}var index=Number(card.dataset.audioIndex||0);if(index>=audios.length){audios.forEach(function(audio){audio.currentTime=0;});resetHighlights(card);index=0;}playAt(card,index);}
  function restartCard(card){audiosFor(card).forEach(function(audio){audio.pause();audio.currentTime=0;});resetHighlights(card);card.dataset.audioIndex="0";playAt(card,0);}
  function setActive(active){if(sheet&&sheet.card!==active)closeSheet(false);cards.forEach(function(card){card.classList.toggle("is-active",card===active);markIndex(card,"is-active",card===active);});updateTransport();}
  var followLock=0;
  function activate(index,autoplay,keepFocus){if(index<0||index>=cards.length)return;followLock=Date.now()+1000;setActive(cards[index]);cards[index].scrollIntoView({behavior:"smooth",block:"start"});if(!keepFocus)cards[index].querySelector(".df-play").focus({preventScroll:true});if(autoplay)playCard(cards[index],true);}
  function goTo(index,keepFocus){activate(index,allAudios().some(function(audio){return !audio.paused;}),keepFocus);}
  cards.forEach(function(card,index){
    var audios=audiosFor(card);
    audios.forEach(function(audio,audioIndex){audio.onended=function(){clearHighlights(card,audio.dataset.audioScene);playAt(card,audioIndex+1);};audio.ontimeupdate=function(){if(audio.paused)return;setHighlight(card,audio.dataset.audioScene,audio.currentTime);updateProgress(card);};});
    card.querySelector(".df-play").addEventListener("click",function(){playCard(card);});
    card.querySelector(".df-restart").addEventListener("click",function(){restartCard(card);});
    card.querySelectorAll(".df-word").forEach(function(word){word.addEventListener("click",function(){var audioIndex=audios.findIndex(function(item){return item.dataset.audioScene===word.dataset.scene;});if(audioIndex<0)return;audios.forEach(function(audio,indexToReset){audio.pause();if(indexToReset>audioIndex){audio.currentTime=0;card.querySelectorAll('.df-word[data-scene="'+audio.dataset.audioScene+'"]').forEach(function(laterWord){laterWord.classList.remove("is-current","is-read");});}});clearHighlights(card);card.dataset.audioIndex=String(audioIndex);audios[audioIndex].currentTime=Number(word.dataset.wordStart);playAt(card,audioIndex);});});
    card.querySelectorAll('input[type="radio"]').forEach(function(input){if(store[input.name]===input.value)input.checked=true;input.addEventListener("change",function(){store[input.name]=input.value;persist();});});
    checklistBoxes(card).forEach(function(box){box.checked=checksFor(card)[box.dataset.checkIndex]===true;box.addEventListener("change",function(){var next={};checklistBoxes(card).forEach(function(item){if(item.checked)next[item.dataset.checkIndex]=true;});store[card.dataset.decision+"-checks"]=next;persist();});});
    var free=card.querySelector(".df-free");if(store[free.dataset.note])free.value=store[free.dataset.note];free.addEventListener("input",function(){store[free.dataset.note]=free.value;persist();});
    card.querySelector(".df-next").addEventListener("click",function(){var button=this;if(cards[index+1]){activate(index+1,true);return;}if(view==="story"){closeSheet(false);button.classList.add("is-acknowledged");button.textContent="All decisions reviewed → Copy answers";var storyCopy=document.querySelector(".df-story-copy");if(storyCopy){storyCopy.classList.add("is-ready");storyCopy.focus({preventScroll:true});}return;}var copy=document.getElementById("df-copy");button.classList.add("is-acknowledged");button.textContent="All decisions reviewed → Copy answers";copy.scrollIntoView({behavior:"smooth",block:"center"});copy.focus({preventScroll:true});});
    card.querySelector(".df-skip").addEventListener("click",function(){var button=this;var nextCard=cards[index+1];button.classList.add("is-acknowledged");button.textContent=nextCard?"Skipped · moving on…":"Skipped";if(!nextCard)return;playCard(nextCard,true);setTimeout(function(){activate(index+1,false);},220);});
    var chip=chipFor(card);if(chip)chip.addEventListener("click",function(){goTo(index);});
    var opener=card.querySelector(".df-answer-open");if(opener)opener.addEventListener("click",function(){openSheet(card,opener);});
    var done=card.querySelector(".df-sheet-done");if(done)done.addEventListener("click",function(){closeSheet(true);});
    var link=indexLink(card);if(link)link.addEventListener("click",function(event){event.preventDefault();goTo(index);});
  });
  if(transportPlay){
    transportPlay.addEventListener("click",function(){playCard(current());});
    transportPrev.addEventListener("click",function(){goTo(cards.indexOf(current())-1,true);});
    transportNext.addEventListener("click",function(){goTo(cards.indexOf(current())+1,true);});
    if(transportStop)transportStop.addEventListener("click",function(){stopCard(current());});
  }
  // Answer sheet: the card's own briefing and answer controls, shown as a modal over story view.
  var sheet=null;
  function focusables(root){return Array.from(root.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')).filter(function(node){return !node.disabled&&!node.closest("[hidden]");});}
  function openSheet(card,opener){
    if(view!=="story"||sheet)return;var node=card.querySelector(".df-sheet");if(!node)return;
    var outside=[document.querySelector(".df-controller"),document.querySelector(".df-top"),document.querySelector(".df-side"),document.getElementById("df-story-top")].concat(Array.from(card.children).filter(function(child){return child!==node;})).filter(Boolean);
    outside=outside.filter(function(el){return el!==backdrop;});
    outside.forEach(function(el){el.setAttribute("inert","");});
    // The story card is its own stacking context, so the backdrop joins it just below the sheet.
    if(backdrop)card.insertBefore(backdrop,node);
    node.setAttribute("role","dialog");node.setAttribute("aria-modal","true");node.setAttribute("aria-labelledby","sheet-title-"+card.dataset.decision);node.classList.add("is-open");
    if(backdrop)backdrop.hidden=false;document.body.classList.add("df-sheet-open");
    sheet={card:card,node:node,opener:opener,outside:outside};
    var first=node.querySelector("input, textarea")||focusables(node)[0];if(first)first.focus({preventScroll:true});
  }
  function closeSheet(returnFocus){
    if(!sheet)return;var open=sheet;sheet=null;
    open.outside.forEach(function(el){el.removeAttribute("inert");});
    ["role","aria-modal","aria-labelledby"].forEach(function(name){open.node.removeAttribute(name);});open.node.classList.remove("is-open");
    if(backdrop)backdrop.hidden=true;document.body.classList.remove("df-sheet-open");
    if(returnFocus&&open.opener&&open.opener.isConnected)open.opener.focus({preventScroll:true});
  }
  if(backdrop)backdrop.addEventListener("click",function(){closeSheet(true);});
  document.addEventListener("keydown",function(event){
    if(!sheet)return;
    if(event.key==="Escape"){event.preventDefault();closeSheet(true);return;}
    if(event.key!=="Tab")return;var list=focusables(sheet.node);if(!list.length)return;
    var first=list[0],last=list[list.length-1],active=document.activeElement;
    if(event.shiftKey&&(active===first||!sheet.node.contains(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!sheet.node.contains(active))){event.preventDefault();first.focus();}
  });
  // List view: while nothing plays, the current card is the one under the controller; a jump holds it for a moment.
  function follow(){if(view!=="list"||Date.now()<followLock||allAudios().some(function(audio){return !audio.paused;}))return;var bar=document.querySelector(".df-controller");var line=(bar?bar.getBoundingClientRect().bottom:0)+24;var card=cards.find(function(item){return item.getBoundingClientRect().bottom>line;});if(card&&card!==current())setActive(card);}
  var followQueued=false;
  if(document.defaultView)document.defaultView.addEventListener("scroll",function(){if(!frame){follow();return;}if(followQueued)return;followQueued=true;frame(function(){followQueued=false;follow();});},{passive:true});
  if(speed)speed.addEventListener("change",function(){var next=Number(speed.value);rate=RATES.indexOf(next)>=0?next:1;applyRate();savePrefs();});
  function toggleView(){closeSheet(false);view=view==="story"?"list":"story";applyView();savePrefs();current().scrollIntoView({block:"start"});}
  if(viewToggle)viewToggle.addEventListener("click",toggleView);
  var storyExit=document.getElementById("df-story-exit");if(storyExit)storyExit.addEventListener("click",function(){toggleView();if(viewToggle)viewToggle.focus({preventScroll:true});});
  function checklistLines(card){var list=card.querySelector(".df-checklist");if(!list)return [];var checks=checksFor(card);var mark=function(box){return (checks[box.dataset.checkIndex]===true?"[x] ":"[ ] ")+box.parentNode.textContent.trim();};var lines=["- checklist: "+checkedCount(card)+" of "+checklistBoxes(card).length+" checked"];Array.from(list.children).forEach(function(node){if(node.classList.contains("df-check-group")){lines.push("  - "+node.querySelector(".df-check-group-title").textContent);node.querySelectorAll(".df-check-input").forEach(function(box){lines.push("    - "+mark(box));});}else if(node.classList.contains("df-check")){lines.push("  - "+mark(node.querySelector(".df-check-input")));}});return lines;}
  function answersText(){var lines=["## Decision answers - "+KEY.replace(/^dbx:/,"")];cards.forEach(function(card){var id=card.dataset.decision;lines.push("### "+card.dataset.title);lines.push("- picked: "+(store[id]||"(no option picked)"));lines.push.apply(lines,checklistLines(card));if(store[id+"-free"])lines.push("- in your words: "+store[id+"-free"]);});return lines.join("\n");}
  function copied(){var state=document.getElementById("df-copy-state");state.textContent="Answers copied";state.classList.add("is-visible");setTimeout(function(){state.classList.remove("is-visible");},1200);}
  function copyAnswers(){var text=answersText();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(copied,function(){fallback(text);});}else fallback(text);}
  document.getElementById("df-copy").addEventListener("click",copyAnswers);
  document.querySelectorAll(".df-story-copy").forEach(function(button){button.addEventListener("click",copyAnswers);});
  function fallback(text){var area=document.createElement("textarea");area.value=text;document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();copied();}
  // Keep focused controls clear of the fixed phone dock and the sticky controller.
  document.addEventListener("focusin",function(event){var dock=document.querySelector(".df-dock");var bar=document.querySelector(".df-controller");var view=document.defaultView;var el=event.target;if(!dock||!view||!el||!el.getBoundingClientRect||dock.contains(el)||(bar&&bar.contains(el))||document.body.dataset.view==="story")return;var box=el.getBoundingClientRect();var underDock=view.getComputedStyle(dock).position==="fixed"&&box.bottom>dock.getBoundingClientRect().top;var underBar=bar&&view.getComputedStyle(bar).position==="sticky"&&box.top<bar.getBoundingClientRect().bottom;if(underDock||underBar)el.scrollIntoView({block:"nearest"});});
  applyRate();applyView();updateCounts();updateTransport();root.dataset.ready="true";
})();
