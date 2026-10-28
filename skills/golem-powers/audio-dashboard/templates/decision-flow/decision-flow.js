(function(){
  /* State model (one concern each):
     card playback  idle -> playing <-> paused -> complete -> playing; one card plays at a time.
     current card   exactly one .is-active card; chips, transport prev/next and card Next/Skip move it,
                    and a move while audio plays hands playback to the new card (nothing plays hidden).
     preferences    rate (one of RATES) and view (list|story), persisted in the dashboard's own store.
     answer sheet   closed -> open (Answer, story view only) -> closed (Done, Esc, backdrop, Next/Skip,
                    another card, list view). Open: dialog role, rest inert, focus trapped; close returns focus.
     comparison     closed -> loading -> loaded | failed (error or timeout) -> loading (Retry); Back/Esc close
                    and return focus to the card's opener. */
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
  function persist(){var saved=true;try{localStorage.setItem(KEY,JSON.stringify(store));storageState.textContent="Answers saved locally.";storageState.classList.remove("is-error");}catch(error){saved=false;storageState.textContent="Storage unavailable · use Copy answers";storageState.classList.add("is-error");}updateCounts();return saved;}
  function savePrefs(){store._prefs={rate:rate,view:view};persist();}
  function checklistBoxes(card){return Array.from(card.querySelectorAll(".df-checklist .df-check-input"));}
  function checksFor(card){var value=store[card.dataset.decision+"-checks"];return value&&typeof value==="object"?value:{};}
  function checkedCount(card){var checks=checksFor(card);return checklistBoxes(card).filter(function(box){return checks[box.dataset.checkIndex]===true;}).length;}
  function checklistComplete(card){var total=checklistBoxes(card).length;return total>0&&checkedCount(card)===total;}
  function notesFor(card){var notes=store[card.dataset.decision+"-notes"];return Array.isArray(notes)?notes.filter(function(note){return note&&typeof note.quote==="string"&&typeof note.text==="string"&&note.text.trim();}):[];}
  function answerMarks(card){var count=notesFor(card).length,done=answered(card),checked=checkedCount(card),total=checklistBoxes(card).length,partial=!done&&checked>0&&checked<total,label=done?"Answered":partial?"In progress, "+checked+" of "+total+" checked":"Awaiting answer";[card.querySelector(".df-card-head"),indexLink(card),chipFor(card)].filter(Boolean).forEach(function(node){var mark=node.querySelector(".df-answer-status");mark.dataset.answered=String(done);mark.dataset.progress=String(partial);mark.style.setProperty("--progress",String(total?checked/total:0));mark.setAttribute("aria-label",label);mark.title=label;if(!node.matches(".df-card-head"))node.setAttribute("aria-label","Section "+card.querySelector(".df-rank").textContent+": "+card.dataset.title+". "+label+(count?". "+count+(count===1?" note":" notes"):""));});[card,chipFor(card)].filter(Boolean).forEach(function(node){var badge=node.querySelector(".df-note-count");badge.textContent=String(count);badge.hidden=!count;badge.setAttribute("aria-label",count+(count===1?" note":" notes"));});}
  function answered(card){var id=card.dataset.decision;return Boolean(store[id]||String(store[id+"-free"]||"").trim()||checklistComplete(card));}
  function updateCounts(){cards.forEach(function(card){var done=answered(card);answerMarks(card);card.classList.toggle("is-answered",done);if(done){var offer=card.querySelector(".df-answer-open");if(offer)offer.classList.remove("is-offer");}markIndex(card,"is-answered",done);var counter=card.querySelector(".df-checklist-count");if(counter)counter.textContent=checkedCount(card)+" of "+checklistBoxes(card).length+" checked";});var count=cards.filter(answered).length;var fill=document.getElementById("df-meter-fill");if(fill)fill.style.width=(cards.length?count/cards.length*100:0)+"%";document.getElementById("df-answered").textContent=String(count);document.getElementById("df-remaining").textContent=String(cards.length-count);}
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
  function setHighlight(card,sceneId,time){var words=Array.from(card.querySelectorAll('.df-word[data-scene="'+sceneId+'"]'));var current=-1;words.forEach(function(word,index){if(time>=Number(word.dataset.wordStart)-0.04)current=index;});words.forEach(function(word,index){word.classList.toggle("is-read",index<current);word.classList.toggle("is-current",index===current);});var mark=sceneId+":"+current;if(current>=0&&card.dataset.hl!==mark){card.dataset.hl=mark;if(!selectionQuote()&&!(noteDialog&&noteDialog.open))words[current].scrollIntoView({block:"nearest"});}}
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
  var followLock=0,jumpToken=0;
  function holdFollow(){
    var token=++jumpToken,win=document.defaultView,lastY=win.scrollY,stillSince=0;
    followLock=Date.now()+5000;
    function settle(){
      if(token!==jumpToken)return;
      var now=Date.now(),y=win.scrollY;
      if(y!==lastY||!stillSince){lastY=y;stillSince=now;}
      if(now>=followLock||now-stillSince>=160){followLock=0;follow();return;}
      frame(settle);
    }
    if(frame)frame(settle);
  }
  function activate(index,autoplay,keepFocus){if(index<0||index>=cards.length)return;holdFollow();setActive(cards[index]);if(!keepFocus)cards[index].querySelector(".df-play").focus({preventScroll:true});cards[index].scrollIntoView({behavior:"smooth",block:"start"});if(autoplay)playCard(cards[index],true);}
  function goTo(index,keepFocus){activate(index,allAudios().some(function(audio){return !audio.paused;}),keepFocus);}
  cards.forEach(function(card,index){
    var audios=audiosFor(card);
    audios.forEach(function(audio,audioIndex){audio.onended=function(){clearHighlights(card,audio.dataset.audioScene);playAt(card,audioIndex+1);};audio.ontimeupdate=function(){if(audio.paused)return;setHighlight(card,audio.dataset.audioScene,audio.currentTime);updateProgress(card);};});
    card.querySelector(".df-play").addEventListener("click",function(){playCard(card);});
    card.querySelector(".df-restart").addEventListener("click",function(){restartCard(card);});
    function seekWord(word){var audioIndex=audios.findIndex(function(item){return item.dataset.audioScene===word.dataset.scene;});if(audioIndex<0)return;audios.forEach(function(audio,indexToReset){audio.pause();if(indexToReset>audioIndex){audio.currentTime=0;card.querySelectorAll('.df-word[data-scene="'+audio.dataset.audioScene+'"]').forEach(function(laterWord){laterWord.classList.remove("is-current","is-read");});}});clearHighlights(card);card.dataset.audioIndex=String(audioIndex);audios[audioIndex].currentTime=Number(word.dataset.wordStart);playAt(card,audioIndex);}
    card.querySelectorAll(".df-words").forEach(function(container){
      var words=Array.from(container.querySelectorAll(".df-word")),cursor=0;
      container.addEventListener("click",function(event){var word=event.target.closest(".df-word"),selection=document.getSelection();if(word&&(!selection||selection.isCollapsed)){cursor=words.indexOf(word);seekWord(word);}});
      container.addEventListener("keydown",function(event){
        if(event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;
        if(event.key==="Enter"){event.preventDefault();var selection=document.getSelection();if(!selection||selection.isCollapsed)seekWord(words[cursor]);return;}
        if(["ArrowLeft","ArrowRight","Home","End"].indexOf(event.key)<0)return;event.preventDefault();document.getSelection().removeAllRanges();
        cursor=event.key==="Home"?0:event.key==="End"?words.length-1:Math.max(0,Math.min(words.length-1,cursor+(event.key==="ArrowRight"?1:-1)));
        words.forEach(function(word,index){word.classList.toggle("is-seek-target",index===cursor);});words[cursor].scrollIntoView({block:"nearest"});document.getElementById("df-seek-state").textContent=words[cursor].textContent+". Press Enter to seek.";
      });
    });
    card.querySelectorAll('input[type="radio"]').forEach(function(input){if(store[input.name]===input.value)input.checked=true;input.addEventListener("change",function(){store[input.name]=input.value;persist();});});
    checklistBoxes(card).forEach(function(box){box.checked=checksFor(card)[box.dataset.checkIndex]===true;box.addEventListener("change",function(){var next={};checklistBoxes(card).forEach(function(item){if(item.checked)next[item.dataset.checkIndex]=true;});store[card.dataset.decision+"-checks"]=next;persist();});});
    var free=card.querySelector(".df-free");if(store[free.dataset.note])free.value=store[free.dataset.note];free.addEventListener("input",function(){store[free.dataset.note]=free.value;persist();});
    card.querySelector(".df-clear").addEventListener("click",function(){var panel=card.querySelector(".df-clear-confirm");panel.hidden=false;this.setAttribute("aria-expanded","true");panel.scrollIntoView({block:"nearest"});panel.querySelector(".df-clear-cancel").focus({preventScroll:true});});
    card.querySelector(".df-clear-cancel").addEventListener("click",function(){closeClear(card);});
    card.querySelector(".df-clear-apply").addEventListener("click",function(){clearCard(card);});
    card.querySelector(".df-next").addEventListener("click",function(){var button=this;if(cards[index+1]){activate(index+1,true);return;}if(view==="story"){closeSheet(false);button.classList.add("is-acknowledged");button.textContent="All decisions reviewed → Copy answers";var storyCopy=document.querySelector(".df-story-copy");if(storyCopy){storyCopy.classList.add("is-ready");storyCopy.focus({preventScroll:true});}return;}var copy=document.getElementById("df-copy");button.classList.add("is-acknowledged");button.textContent="All decisions reviewed → Copy answers";copy.scrollIntoView({behavior:"smooth",block:"center"});copy.focus({preventScroll:true});});
    card.querySelector(".df-skip").addEventListener("click",function(){var button=this;var nextCard=cards[index+1];button.classList.add("is-acknowledged");button.textContent=nextCard?"Skipped · moving on…":"Skipped";if(nextCard)activate(index+1,true);});
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
    offerCitation();
    var first=node.querySelector("input, textarea")||focusables(node)[0];if(first)first.focus({preventScroll:true});
  }
  function closeSheet(returnFocus){
    if(!sheet)return;var open=sheet;sheet=null;
    open.outside.forEach(function(el){el.removeAttribute("inert");});
    ["role","aria-modal","aria-labelledby"].forEach(function(name){open.node.removeAttribute(name);});open.node.classList.remove("is-open");
    if(backdrop)backdrop.hidden=true;document.body.classList.remove("df-sheet-open");
    offerCitation();
    if(returnFocus&&open.opener&&open.opener.isConnected)open.opener.focus({preventScroll:true});
  }
  if(backdrop)backdrop.addEventListener("click",function(){closeSheet(true);});
  function closeClear(card){card.querySelector(".df-clear-confirm").hidden=true;card.querySelector(".df-clear-error").textContent="";var button=card.querySelector(".df-clear");button.setAttribute("aria-expanded","false");button.focus({preventScroll:true});}
  function clearCard(card){
    var original=store,id=card.dataset.decision;store=Object.assign({},store);["","-checks","-free","-notes"].forEach(function(suffix){delete store[id+suffix];});
    if(!persist()){store=original;updateCounts();card.querySelector(".df-clear-error").textContent="Couldn't clear on this device. Answers kept. Try Clear this card again.";return;}
    card.querySelectorAll('input[type="radio"], .df-check-input').forEach(function(input){input.checked=false;});card.querySelector(".df-free").value="";closeClear(card);
  }
  document.addEventListener("keydown",function(event){
    if(compareView){if(event.key==="Escape"){event.preventDefault();closeCompare();}return;}
    if(event.key==="Escape"&&!(noteDialog&&noteDialog.open)){var focusedCard=document.activeElement&&document.activeElement.closest(".df-card"),pending=focusedCard&&focusedCard.querySelector(".df-clear-confirm:not([hidden])");if(pending){event.preventDefault();closeClear(focusedCard);return;}}
    var modal=noteDialog&&noteDialog.open?noteDialog:sheet&&sheet.node;if(!modal)return;
    if(event.key==="Escape"){event.preventDefault();if(modal===noteDialog)closeNote(true);else closeSheet(true);return;}
    if(event.key!=="Tab")return;var list=focusables(modal);if(modal!==noteDialog&&cite&&!cite.hidden)list.push(cite);if(!list.length)return;
    var first=list[0],last=list[list.length-1],active=document.activeElement,inside=modal.contains(active)||active===cite;
    if(event.shiftKey&&(active===first||!inside)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!inside)){event.preventDefault();first.focus();}
  });
  // Idle list view follows the largest visible card; the last card wins at the document bottom.
  function follow(){
    if(view!=="list"||Date.now()<followLock||allAudios().some(function(audio){return !audio.paused;}))return;
    var win=document.defaultView,bar=document.querySelector(".df-controller"),dock=document.querySelector(".df-dock"),line=(bar?bar.getBoundingClientRect().bottom:0)+24,bottom=win.innerHeight;
    if(dock&&win.getComputedStyle(dock).position==="fixed")bottom=Math.min(bottom,dock.getBoundingClientRect().top);
    var atBottom=root.scrollHeight>win.innerHeight&&win.scrollY+win.innerHeight>=root.scrollHeight-1,card=atBottom?cards[cards.length-1]:null,best=0;
    if(!card)cards.forEach(function(item){var rect=item.getBoundingClientRect(),visible=Math.max(0,Math.min(rect.bottom,bottom)-Math.max(rect.top,line));if(visible>best){best=visible;card=item;}});
    if(card&&card!==current())setActive(card);
  }
  var followQueued=false;
  if(document.defaultView)document.defaultView.addEventListener("scroll",function(){if(!frame){follow();return;}if(followQueued)return;followQueued=true;frame(function(){followQueued=false;follow();});},{passive:true});
  if(speed)speed.addEventListener("change",function(){var next=Number(speed.value);rate=RATES.indexOf(next)>=0?next:1;applyRate();savePrefs();});
  function toggleView(){closeSheet(false);view=view==="story"?"list":"story";applyView();savePrefs();current().scrollIntoView({block:"start"});}
  if(viewToggle)viewToggle.addEventListener("click",toggleView);
  var storyExit=document.getElementById("df-story-exit");if(storyExit)storyExit.addEventListener("click",function(){toggleView();if(viewToggle)viewToggle.focus({preventScroll:true});});
  function checklistLines(card){var list=card.querySelector(".df-checklist");if(!list)return [];var checks=checksFor(card);var mark=function(box){return (checks[box.dataset.checkIndex]===true?"[x] ":"[ ] ")+box.parentNode.textContent.trim();};var lines=["- checklist: "+checkedCount(card)+" of "+checklistBoxes(card).length+" checked"];Array.from(list.children).forEach(function(node){if(node.classList.contains("df-check-group")){lines.push("  - "+node.querySelector(".df-check-group-title").textContent);node.querySelectorAll(".df-check-input").forEach(function(box){lines.push("    - "+mark(box));});}else if(node.classList.contains("df-check-row")){lines.push("  - "+mark(node.querySelector(".df-check-input")));}});return lines;}
  function answersText(){var lines=["## Decision answers - "+KEY.replace(/^dbx:/,"")];cards.forEach(function(card){var id=card.dataset.decision;lines.push("### "+card.dataset.title);lines.push("- picked: "+(store[id]||"(no option picked)"));lines.push.apply(lines,checklistLines(card));if(store[id+"-free"])lines.push("- in your words: "+store[id+"-free"]);notesFor(card).forEach(function(note){lines.push("",note.quote.split("\n").map(function(line){return "> "+line;}).join("\n"),"",note.text);});});return lines.join("\n");}
  function copied(){var state=document.getElementById("df-copy-state");state.textContent="Answers copied";state.classList.add("is-visible");setTimeout(function(){state.classList.remove("is-visible");},1200);}
  function copyAnswers(){var text=answersText();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(copied,function(){fallback(text);});}else fallback(text);}
  document.getElementById("df-copy").addEventListener("click",copyAnswers);
  document.querySelectorAll(".df-story-copy").forEach(function(button){button.addEventListener("click",copyAnswers);});
  function fallback(text){var area=document.createElement("textarea");area.value=text;document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();copied();}
  // Citation: no selection -> Cite offered -> modal draft -> saved, cancelled, or retryable storage error.
  var noteDialog=document.getElementById("df-note-dialog"),noteText=document.getElementById("df-note-text"),noteQuote=document.getElementById("df-note-quote"),noteError=document.getElementById("df-note-error"),noteDelete=document.getElementById("df-note-delete"),draftCopy=document.getElementById("df-note-copy-draft"),cite=document.getElementById("df-cite"),touchCite=document.getElementById("df-controller-cite"),armedCitation=null,noteEditor=null;
  function selectionQuote(){
    var selection=document.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return null;
    var range=selection.getRangeAt(0),start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    var card=start&&start.closest(".df-card"),quote=selection.toString().trim(),label=start&&start.closest(".df-scene-label");
    if(label&&label.contains(range.endContainer))return null;
    var contents=range.cloneContents();if(contents.querySelector(".df-scene-label")){
      contents.querySelectorAll(".df-scene-label").forEach(function(node){node.remove();});contents.querySelectorAll("p,section,div,label,small").forEach(function(node){node.appendChild(document.createTextNode("\n"));});quote=contents.textContent.replace(/\n{3,}/g,"\n\n").trim();
    }
    return card&&card.contains(range.endContainer)&&quote&&!start.closest("input,textarea")?{card:card,quote:quote,range:range,opener:start.closest(".df-words")||start.closest("button")||(sheet&&sheet.node.contains(start)?sheet.node.querySelector(".df-sheet-done"):card.querySelector(".df-card-note"))}:null;
  }
  function offerCitation(){
    var selected=selectionQuote()||armedCitation,win=document.defaultView,touch=win.matchMedia("(pointer: coarse)").matches;
    var home=sheet?sheet.node.querySelector(".df-sheet-head"):transportNext.parentNode;
    if(touchCite.parentNode!==home){if(sheet)home.insertBefore(touchCite,home.querySelector(".df-sheet-done"));else transportNext.insertAdjacentElement("afterend",touchCite);}
    cite.hidden=!selected||noteDialog.open||touch;touchCite.hidden=!selected||noteDialog.open||!touch;if(cite.hidden)return;
    var rect=selected.range.getBoundingClientRect();
    cite.style.left=Math.max(8,Math.min(rect.left,win.innerWidth-cite.offsetWidth-8))+"px";cite.style.top=Math.max(8,Math.min(rect.top<56?rect.bottom+8:rect.top-50,win.innerHeight-cite.offsetHeight-8))+"px";
  }
  function openNote(card,quote,opener){
    if(noteDialog.open)return;if(isPlaying(card))pauseCard(card);cite.hidden=true;touchCite.hidden=true;armedCitation=null;
    noteEditor={card:card,quote:quote,opener:opener,editing:null,sheetModal:sheet&&sheet.node.getAttribute("aria-modal")};noteQuote.textContent=quote;noteText.value="";noteError.textContent="";noteDelete.hidden=true;draftCopy.hidden=true;
    document.getElementById("df-note-card").textContent=card.dataset.title;
    var list=document.getElementById("df-note-list");list.replaceChildren();
    notesFor(card).forEach(function(note,index){var button=document.createElement("button");button.type="button";button.className="df-note-edit";button.textContent=note.quote+"\n"+note.text;button.setAttribute("aria-label","Edit note: "+note.quote+". "+note.text);button.addEventListener("click",function(){noteEditor.editing=index;noteEditor.quote=note.quote;noteQuote.textContent=note.quote;noteText.value=note.text;noteDelete.hidden=false;noteError.textContent="";noteText.focus();});list.appendChild(button);});
    if(sheet)sheet.node.removeAttribute("aria-modal");noteDialog.showModal();noteText.focus();document.getSelection().removeAllRanges();
  }
  function closeNote(returnFocus){
    if(!noteEditor)return;var opener=noteEditor.opener,sheetModal=noteEditor.sheetModal;noteEditor=null;noteDialog.close();if(sheet&&sheetModal)sheet.node.setAttribute("aria-modal",sheetModal);
    if(returnFocus!==false&&opener&&opener.isConnected)opener.focus({preventScroll:true});
  }
  function saveNote(remove){
    if(!noteEditor)return;var text=noteText.value.trim();if(!remove&&!text){noteError.textContent="Write a note before saving.";noteText.focus();return;}
    var key=noteEditor.card.dataset.decision+"-notes",original=store[key],next=notesFor(noteEditor.card).slice(),index=noteEditor.editing;
    if(remove)next.splice(index,1);else if(index===null)next.push({quote:noteEditor.quote,text:text});else next[index]={quote:noteEditor.quote,text:text};
    store[key]=next;if(!persist()){if(original===undefined)delete store[key];else store[key]=original;updateCounts();draftCopy.hidden=remove;noteError.textContent=remove?"Couldn't delete on this device. The note is still saved. Try Delete note again.":"Couldn't save on this device. Your draft is still here. Try Save note again, or Copy draft.";return;}
    closeNote(true);
  }
  cards.forEach(function(card){card.querySelector(".df-card-note").addEventListener("click",function(){openNote(card,card.dataset.title,this);});card.querySelectorAll(".df-item-note").forEach(function(button){button.addEventListener("click",function(){openNote(card,button.previousElementSibling.querySelector("span").textContent,button);});});});
  document.addEventListener("selectionchange",offerCitation);document.addEventListener("scroll",offerCitation,true);
  [cite,touchCite].forEach(function(button){button.addEventListener("pointerdown",function(event){armedCitation=selectionQuote();event.preventDefault();});button.addEventListener("pointercancel",function(){armedCitation=null;offerCitation();});button.addEventListener("click",function(){var selected=armedCitation||selectionQuote();armedCitation=null;if(selected)openNote(selected.card,selected.quote,selected.opener);});});
  document.addEventListener("pointerdown",function(event){if(!event.target.closest("#df-cite,#df-controller-cite")){armedCitation=null;offerCitation();}});
  document.getElementById("df-note-save").addEventListener("click",function(){saveNote(false);});noteDelete.addEventListener("click",function(){saveNote(true);});
  document.getElementById("df-note-cancel").addEventListener("click",function(){closeNote(true);});noteDialog.addEventListener("cancel",function(event){event.preventDefault();closeNote(true);});
  draftCopy.addEventListener("click",function(){
    var editor=noteEditor,text=noteQuote.textContent.split("\n").map(function(line){return "> "+line;}).join("\n")+"\n\n"+noteText.value;
    function copiedDraft(){if(noteEditor===editor)noteError.textContent="Draft copied. It is not saved on this device.";}
    function fallbackDraft(){if(noteEditor!==editor)return;var area=document.createElement("textarea");area.value=text;noteDialog.appendChild(area);area.select();var ok=false;try{ok=document.execCommand("copy");}catch(error){}area.remove();noteText.focus();if(ok)copiedDraft();else noteError.textContent="Copy unavailable. Select your quote and note to copy them.";}
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(copiedDraft,fallbackDraft);else fallbackDraft();
  });
  // Comparison: closed -> loading -> loaded | failed (frame error, or no load within the card's bound) -> loading on Retry.
  // Each attempt gets a fresh frame and token, so a late event or timer from an earlier attempt cannot settle the current one.
  var compare=document.getElementById("df-compare"),compareView=null,compareAttempt=0;
  function compareStatus(state,message){compare.dataset.state=state;document.getElementById("df-compare-message").textContent=message;["df-compare-retry","df-compare-close"].forEach(function(id){document.getElementById(id).hidden=state!=="failed";});}
  function settleCompare(token,state,message){if(!compareView||token!==compareAttempt||compare.dataset.state!=="loading")return;compareStatus(state,message);if(state==="failed"&&compare.contains(document.activeElement))document.getElementById("df-compare-retry").focus();}
  // Browsers fire load, not error, for network failures and HTTP errors, so a load proves nothing alone.
  // The target is same-origin by contract: an unreadable frame is a browser error page; a 4xx/5xx is a failed page.
  function frameProblem(frame){
    var failed="The comparison couldn't load. Retry, or go back to the card.";
    if(document.location.protocol==="file:"||!frame.contentWindow)return "";
    try{var nav=frame.contentWindow.performance.getEntriesByType("navigation")[0];return nav&&nav.responseStatus>=400?failed:"";}catch(error){return failed;}
  }
  function loadCompare(){
    var token=++compareAttempt,view=compareView,frame=document.createElement("iframe"),seconds=String(Math.round(view.timeout/100)/10);
    frame.className="df-compare-frame";frame.title=view.title;
    frame.addEventListener("load",function(){var problem=frameProblem(frame);settleCompare(token,problem?"failed":"loaded",problem);});
    frame.addEventListener("error",function(){settleCompare(token,"failed","The comparison couldn't load. Retry, or go back to the card.");});
    compareStatus("loading","Loading comparison…");
    // src before insertion: an empty frame fires an about:blank load that would read as success.
    frame.src=view.url;document.getElementById("df-compare-stage").replaceChildren(frame);
    setTimeout(function(){settleCompare(token,"failed","The comparison didn't load within "+seconds+" seconds. Retry, or go back to the card.");},view.timeout);
  }
  function openCompare(card,button){if(compareView)return;if(isPlaying(card))pauseCard(card);compareView={opener:button,url:button.dataset.compareUrl,title:button.dataset.compareTitle,timeout:Number(button.dataset.compareTimeout)||10000};document.getElementById("df-compare-title").textContent=compareView.title;compare.showModal();document.getElementById("df-compare-back").focus();loadCompare();}
  function closeCompare(){if(!compareView)return;var opener=compareView.opener;compareView=null;compareAttempt++;document.getElementById("df-compare-stage").replaceChildren();compareStatus("idle","");compare.close();if(opener&&opener.isConnected)opener.focus({preventScroll:true});}
  if(compare){
    cards.forEach(function(card){var button=card.querySelector(".df-compare-open");if(button)button.addEventListener("click",function(){openCompare(card,button);});});
    document.getElementById("df-compare-retry").addEventListener("click",function(){if(!compareView)return;document.getElementById("df-compare-back").focus();loadCompare();});
    ["df-compare-back","df-compare-close"].forEach(function(id){document.getElementById(id).addEventListener("click",closeCompare);});
    compare.addEventListener("cancel",function(event){event.preventDefault();closeCompare();});
  }
  // Keep focused controls clear of the fixed phone dock and the sticky controller.
  document.addEventListener("focusin",function(event){var dock=document.querySelector(".df-dock");var bar=document.querySelector(".df-controller");var view=document.defaultView;var el=event.target;if(!dock||!view||!el||!el.getBoundingClientRect||el.closest(".df-words")||el.closest(".df-note-dialog")||dock.contains(el)||(bar&&bar.contains(el))||document.body.dataset.view==="story")return;var box=el.getBoundingClientRect();var underDock=view.getComputedStyle(dock).position==="fixed"&&box.bottom>dock.getBoundingClientRect().top;var underBar=bar&&view.getComputedStyle(bar).position==="sticky"&&box.top<bar.getBoundingClientRect().bottom;if(underDock||underBar)el.scrollIntoView({block:"nearest"});});
  applyRate();applyView();updateCounts();updateTransport();root.dataset.ready="true";
})();
