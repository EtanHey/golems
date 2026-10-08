    function reset_block(    i) {
      clear_events()
      block_self = 0
      block_has_heading = 0
      block_known_author = 0
      block_worker = 0
      self_heading_index = 0
    }
    function clear_events(    i) {
      for (i = 1; i <= event_count; i++) {
        delete events[i]
        delete event_is_heading[i]
        delete event_episode[i]
        delete event_offset[i]
      }
      event_count = 0
    }
    function name_ends(value, position,    next_char) {
      next_char = substr(value, position, 1)
      return next_char == "" || next_char !~ /[[:alnum:]_-]/
    }
    function is_token(name,    i) {
      for (i = 1; i <= token_count; i++) if (name == tokens[i]) return 1
      return 0
    }
    function has_any_mention(value,    i) {
      for (i = 1; i <= token_count; i++) if (has_exact_mention(value, tokens[i])) return 1
      return 0
    }
    function has_name(value, name,    remaining, position, before, previous_char) {
      remaining = value
      while ((position = index(remaining, name)) > 0) {
        before = substr(remaining, 1, position - 1)
        previous_char = substr(before, length(before), 1)
        if (previous_char == "@") {
          before = substr(before, 1, length(before) - 1)
          previous_char = substr(before, length(before), 1)
        }
        if ((previous_char == "" || previous_char !~ /[[:alnum:]_.@-]/) && name_ends(remaining, position + length(name))) return 1
        remaining = substr(remaining, position + 1)
      }
      return 0
    }
    function has_worker_ref(value,    i, remaining, position, previous_char, rest, digits) {
      for (i = 1; i <= token_count; i++) {
        remaining = value
        while ((position = index(remaining, tokens[i] "-")) > 0) {
          previous_char = substr(remaining, position - 1, 1)
          rest = substr(remaining, position + length(tokens[i]) + 1)
          if ((position == 1 || previous_char !~ /[[:alnum:]_.-]/) && match(rest, /^[wr][0-9]+/) && name_ends(rest, RLENGTH + 1)) return 1
          remaining = substr(remaining, position + 1)
        }
      }
      return 0
    }
    function has_status_word(value) {
      return value ~ /(^|[^[:alnum:]_])(DONE|BLOCKED)([^[:alnum:]]|$)/
    }
    function is_worker_name(name,    i, rest) {
      for (i = 1; i <= token_count; i++) {
        if (substr(name, 1, length(tokens[i]) + 1) == tokens[i] "-") {
          rest = substr(name, length(tokens[i]) + 2)
          if (rest ~ /^[wr][0-9]+$/) return 1
        }
      }
      return 0
    }
    function heading_authors(value, arrow,    field, dash, segments, segment_count, i, segment, had_at, first) {
      heading_known = 0
      heading_self = 0
      heading_worker = 0
      field = tolower(value)
      if (arrow) field = substr(field, 1, arrow - 1)
      sub(/^[[:space:]]*#+[[:space:]]+/, "", field)
      gsub(/\([^)]*\)/, "", field)
      dash = index(field, "—")
      if (dash) field = substr(field, 1, dash - 1)
      dash = index(field, " - ")
      if (dash) field = substr(field, 1, dash - 1)
      segment_count = split(field, segments, "·")
      for (i = 1; i <= segment_count; i++) {
        segment = trim(segments[i])
        had_at = substr(segment, 1, 1) == "@"
        if (had_at) segment = substr(segment, 2)
        first = segment
        sub(/[[:space:]].*$/, "", first)
        if (first !~ /^[[:alnum:]_.-]+$/) continue
        if (!had_at && trim(substr(segment, length(first) + 1)) != "") continue
        heading_known = 1
        if (is_token(first)) heading_self = 1
        if (is_worker_name(first)) heading_worker = 1
      }
    }
    function release_known_block(    i) {
      if (!block_known_author || block_self || event_count == 0) return
      for (i = 1; i <= event_count; i++) {
        emit_event("INBOUND", i)
      }
      clear_events()
    }
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    function clean_line(value) {
      gsub(/`/, "", value)
      return value
    }
    function has_exact_mention(value, token,    remaining, position, previous_char) {
      remaining = value
      while ((position = index(remaining, "@" token)) > 0) {
        previous_char = substr(remaining, position - 1, 1)
        if ((position == 1 || previous_char !~ /[[:alnum:]_.@-]/) && name_ends(remaining, position + length(token) + 1)) return 1
        remaining = substr(remaining, position + 1)
      }
      return 0
    }
    function routed_recipient(value,    field, em_dash, ascii_dash, i) {
      field = tolower(trim(clean_line(value)))
      em_dash = index(field, "—")
      ascii_dash = index(field, " - ")
      if (ascii_dash && (!em_dash || ascii_dash < em_dash)) em_dash = ascii_dash
      if (em_dash) field = substr(field, 1, em_dash - 1)
      for (i = 1; i <= token_count; i++) if (has_name(field, tokens[i])) return 1
      return 0
    }
    function add_event(value, is_heading) {
      event_count++
      events[event_count] = value
      event_is_heading[event_count] = is_heading
      if (is_heading) {
        # Stable within an append-only file, even when the report body grows.
        event_episode[event_count] = ++heading_occurrences[value]
        event_offset[event_count] = line_offset + length(value)
      }
    }
    function emit_event(record_type, i,    kind) {
      if (events[i] == "") return
      kind = record_type
      # Keep the first occurrence's legacy hash and copied-file dedup contract.
      if (event_episode[i] > 1) kind = kind ":" event_episode[i] ":" event_offset[i]
      print kind "\t" events[i]
    }
    function flush_block(complete,    i, record_type) {
      if (complete) {
        record_type = block_self ? "SELF" : "INBOUND"
        for (i = 1; i <= event_count; i++) {
          emit_event(record_type, i)
        }
      }
      reset_block()
    }
    function flush_incomplete_end(    i, record_type) {
      record_type = block_self ? "SELF" : "INBOUND"
      for (i = 1; i <= event_count; i++) {
        if (event_is_heading[i]) emit_event(record_type, i)
      }
      reset_block()
    }
    function direct_event(value, token,    lowered, rest, first, next_char) {
      lowered = tolower(trim(clean_line(value)))
      if (substr(lowered, 1, length(token) + 1) == "@" token) {
        next_char = substr(lowered, length(token) + 2, 1)
        if (next_char == "" || next_char !~ /[[:alnum:]_.-]/) {
          rest = trim(substr(lowered, length(token) + 2))
          first = substr(rest, 1, 1)
          if (first == ":" || first == "-" || substr(rest, 1, length("—")) == "—") return 1
        }
      }
      if (substr(lowered, 1, length("→")) == "→") {
        rest = trim(substr(lowered, length("→") + 1))
        if (substr(rest, 1, 1) == "@") rest = substr(rest, 2)
        if (substr(rest, 1, length(token)) == token) {
          next_char = substr(rest, length(token) + 1, 1)
          if (next_char == "" || next_char !~ /[[:alnum:]_.-]/) {
            rest = trim(substr(rest, length(token) + 1))
            first = substr(rest, 1, 1)
            if (rest == "" || first == ":" || first == "-" || substr(rest, 1, length("—")) == "—") return 1
          }
        }
      }
      return 0
    }
    function signature_name(value,    lowered, rest) {
      lowered = tolower(trim(clean_line(value)))
      if (substr(lowered, 1, length("—")) == "—") {
        rest = trim(substr(lowered, length("—") + 1))
      } else if (substr(lowered, 1, 2) == "--") {
        rest = trim(substr(lowered, 3))
      } else {
        return ""
      }
      if (rest ~ /^@[[:alnum:]_.-]+$/) return substr(rest, 2)
      return ""
    }
    function list_marker(value,    stripped, count) {
      stripped = value
      count = 0
      while (count < 3 && substr(stripped, 1, 1) == " ") {
        stripped = substr(stripped, 2)
        count++
      }
      return stripped ~ /^[-+*][[:space:]]+/ || stripped ~ /^[0-9]+[.)][[:space:]]+/
    }
    function list_content(value,    stripped, count) {
      stripped = value
      count = 0
      while (count < 3 && substr(stripped, 1, 1) == " ") {
        stripped = substr(stripped, 2)
        count++
      }
      if (stripped ~ /^[-+*][[:space:]]+/) {
        sub(/^[-+*][[:space:]]+/, "", stripped)
      } else {
        sub(/^[0-9]+[.)][[:space:]]+/, "", stripped)
      }
      return stripped
    }
    function any_direct_event(value,    i) {
      for (i = 1; i <= token_count; i++) if (direct_event(value, tokens[i])) return 1
      return 0
    }
    function is_signature_line(value,    stripped) {
      stripped = trim(clean_line(value))
      return substr(stripped, 1, length("—")) == "—" || substr(stripped, 1, 2) == "--"
    }
    function worker_status_event(value) {
      return has_status_word(value) && (block_worker || has_worker_ref(tolower(value)))
    }
    BEGIN {
      token = tolower(bare)
      token_count = split(tolower(bare " " aliases), tokens, " ")
      in_fence = 0
      fence_character = ""
      fence_length = 0
      in_list_item = 0
      reset_block()
    }
    {
      original = $0
      line_offset = byte_offset
      byte_offset += length(original) + 1
      indent_spaces = 0
      while (substr(original, indent_spaces + 1, 1) == " ") indent_spaces++
      starts_with_tab = substr(original, 1, 1) == "\t"
      is_indented = starts_with_tab || indent_spaces >= 4
      is_list_marker = list_marker(original)
      if (is_list_marker) {
        in_list_item = 1
      } else if (original !~ /^[[:space:]]*$/ && !is_indented) {
        in_list_item = 0
      }
      fence_text = original
      if (is_list_marker) fence_text = list_content(original)
      leading_spaces = 0
      while (leading_spaces < 3 && substr(fence_text, 1, 1) == " ") {
        fence_text = substr(fence_text, 2)
        leading_spaces++
      }
      if (in_list_item && leading_spaces == 3 && substr(fence_text, 1, 1) == " ") {
        fence_text = substr(fence_text, 2)
        leading_spaces++
      }
      marker_character = substr(fence_text, 1, 1)
      marker_length = 0
      if (marker_character == "`" || marker_character == "~") {
        while (substr(fence_text, marker_length + 1, 1) == marker_character) marker_length++
      }
      marker_remainder = substr(fence_text, marker_length + 1)
      if (marker_length >= 3) {
        if (in_fence && marker_character == fence_character && marker_length >= fence_length && marker_remainder ~ /^[[:space:]]*$/) {
          in_fence = 0
          fence_character = ""
          fence_length = 0
          next
        }
        if (!in_fence && !(marker_character == "`" && marker_remainder ~ /`/)) {
          in_fence = 1
          fence_character = marker_character
          fence_length = marker_length
          next
        }
      }
      if (in_fence || (is_indented && !(in_list_item && !starts_with_tab && indent_spaces == 4))) next

      cleaned = clean_line(original)
      lowered = tolower(cleaned)
      is_heading = cleaned ~ /^[[:space:]]*#+[[:space:]]/

      if (is_heading && (event_count > 0 || block_has_heading)) flush_block(1)
      if (is_heading) {
        block_has_heading = 1
        arrow = index(cleaned, "→")
        arrow_length = length("→")
        if (!arrow) {
          arrow = index(cleaned, "->")
          arrow_length = 2
        }
        heading_authors(cleaned, arrow)
        block_known_author = heading_known
        block_worker = heading_worker
        heading_added = 0
        if (heading_self || (arrow && has_any_mention(tolower(substr(cleaned, 1, arrow - 1))))) {
          block_self = 1
          add_event(original, 1)
          self_heading_index = event_count
          heading_added = 1
        }
        if (!heading_added && ((arrow && routed_recipient(substr(cleaned, arrow + arrow_length))) || has_any_mention(lowered) || worker_status_event(cleaned))) add_event(original, 1)
      } else if (any_direct_event(original) || (!is_signature_line(original) && has_any_mention(lowered)) || worker_status_event(cleaned)) {
        add_event(original, 0)
      }

      author = signature_name(original)
      if (author != "") {
        block_self = is_token(author)
        if (!block_self && self_heading_index > 0) events[self_heading_index] = ""
        flush_block(1)
      } else {
        release_known_block()
      }
    }
    END {
      if (in_fence) exit 3
      if (event_count > 0 || block_has_heading) flush_incomplete_end()
    }
