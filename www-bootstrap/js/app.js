  const API_PATH = "https://ppriuj7e7i.execute-api.us-east-1.amazonaws.com/prod";
  const CODE_SNIPPETS_PATH = "https://s3.amazonaws.com/neo4j-sandbox-code-snippets";

  const AUTH_URL_ORIGIN = "https://auth.neo4j.com";
  const AUTH_URL = "https://auth.neo4j.com/index-sandbox-v2.html";
  const AUTH_CLIENT_ID = "DxhmiF8TCeznI7Xoi08UyYScLGZnk4ke";
  const AUTH_DELEGATION_URL = "https://neo4j-sync.auth0.com/delegation"
  const AUTH_AUTHORIZE_URL = "https://neo4j-sync.auth0.com/authorize"
  const AUTH_USERINFO_URL = "https://neo4j-sync.auth0.com/userinfo"
  const AUTH_BROWSER_TARGET = "4cOfw0H4nyxcZH4JV2FU4HYKnn9Oz6os";

  var pollInterval;
  var usecases = false;
  var runningInstances = false;
  var editors = {};
  var identityName = '';
  var activeUsecases = {}
  var activeInstancesUpdated = false;
  var emailVerificationNotNeeded = false;
  var emailVerified = false;
  var activeInstances = [];
  var authRenewPeriod = 1000 * 60 * 60;
  var refreshingAuth = false;
  var browserIdToken = false;

  var shaObj = new jsSHA("SHA-256", "TEXT");

  var listener = function(event) {
    if (event.origin == AUTH_URL_ORIGIN && event.data instanceof Object && 'fromRenew' in event.data && event.data.fromRenew ) {
      ga('send', 'event', 'auth', 'renew webevent back from auth0');
      localStorage.setItem('id_token', event.data.idToken)
      localStorage.setItem('access_token', event.data.accessToken)
    } else if (event.origin == AUTH_URL_ORIGIN && event.data instanceof Object) {
      ga('send', 'event', 'auth', 'webevent back from auth0');
      
      $('.jumbotron').fadeOut("fast");
      $('.marketing').fadeOut("fast");
      $('.btn-login').hide();
      $('.btn-logout').show();
      $('.btn-launch').show();
      //$('#logs').show();
      localStorage.setItem('id_token', event.data.token)
      localStorage.setItem('profile', JSON.stringify(event.data.profile))
      localStorage.setItem('access_token', event.data.accessToken)
      localStorage.setItem('refresh_token', event.data.refreshToken)

      conditional_add_lead();

      getBrowserToken(true, authRenewPeriod);
      updateIdentity();
      profileObj = event.data.profile
      if ('user_id' in profileObj) {
        shaObj.update(profileObj['user_id']);
        hash = shaObj.getHash("HEX");
        ga('set', 'userId', hash);
      } else if ('sub' in profileObj) {
        shaObj.update(profileObj['sub']);
        hash = shaObj.getHash("HEX");
        ga('set', 'userId', hash);
      }

      emailVerificationCheck(false);
      event.source.close();
    }
  }

  var conditional_add_lead = function() {
    ga('send', 'event', 'sandbox', 'conditional-add-lead');
    var id_token = localStorage.getItem('id_token');
    var formValuesObj = {
      "utmSource": Cookies.get('neo_utm_s'),
      "marketoCookie": Cookies.get('_mkto_trk')
    }
    $.ajax
    ({
      type: "POST",
      url: `${API_PATH}/SandboxConditionalAddLead`,
      dataType: 'json',
      data: JSON.stringify(formValuesObj),
      contentType: "application/json",
      async: true,
      headers: {
        "Authorization": id_token
      },
      success: function (data){
        if (data['leadStatus'] == 'NEW') {
          ga('send', 'event', 'sandbox', 'conditional-add-lead-status-' + data['leadStatus']);
        } else {
          ga('send', 'event', 'sandbox', 'conditional-add-lead-status-' + data['leadStatus']);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        ga('send', 'event', 'sandbox', 'conditional-add-lead-error');
      }
    });
  }

  var getBrowserToken = function(retryOnce, nextTimeout) {
    $.ajax
    ({
      type: "POST",
      url: AUTH_DELEGATION_URL,
      contentType: "application/json",
      dataType: 'json',
      async: true,
      data: JSON.stringify(
        { "client_id": AUTH_CLIENT_ID,
          "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "target": AUTH_BROWSER_TARGET,
          "id_token": localStorage.getItem('id_token')
        }),
      success: function (data){
        browserIdToken = data.id_token;
        if (nextTimeout) {
          setTimeout(
            function () {
              getBrowserToken(true, nextTimeout)
            }, nextTimeout
          )
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        if (retryOnce) {
          getBrowserToken(false, false);
        } 
      }
    });
  }

  var updateIdentity = function() {
    var profile = JSON.parse(localStorage.getItem('profile'));
    if('given_name' in profile) {
      identityName = profile['given_name'];
    } else if('name' in profile) {
      identityName = profile['name'];
    } else if('nickname' in profile) {
      identityName = profile['nickname'];
    } else if('email' in profile) {
      identityName = profile['email'];
    } 
    $('#identityGreeting').text("Greetings " + identityName);
    $('#identityContainer').fadeIn('fast');
  }

  var getTimeDiff = function(time1, time2) {
    var hourDiff = time2 - time1;
    var diffDays = Math.floor(hourDiff / 86400000);
    var diffHrs = Math.floor((hourDiff % 86400000) / 3600000);
    var diffMins = Math.floor(((hourDiff % 86400000) % 3600000) / 60000);
    return {"days": diffDays, "hours": diffHrs, "mins": diffMins};
  }
   
  if (window.addEventListener){
    addEventListener("message", listener, false)
  } else {
    attachEvent("onmessage", listener)
  }

  var serializeForm = function(formObj) {
    var values = {};
    $.each($(formObj).serializeArray(), 
      function() { 
        values[this.name] = this.value; 
      });
    return values;
  }

  var shutdownInstanceAction = function(sandboxDiv, instance, clickItem) {
    clickItem.click( function() {
        shutdownInstance(instance.sandboxHashKey, sandboxDiv);
        sandboxDiv.fadeTo(400, 0.3);
        sandboxDiv.attr('style', '-webkit-filter: grayscale(1);');
    });
  }

  var backupInstanceAction = function(sandboxDiv, instance, clickItem) {
    clickItem.click( function() {
        backupInstance(instance.sandboxHashKey, sandboxDiv);
        //sandboxDiv.fadeTo(400, 0.3);
        //sandboxDiv.attr('style', '-webkit-filter: grayscale(1);');
    });
  }

  var loginButtonAction = function(e) {
    ga('send', 'event', 'auth', 'clicked login button');
    $('.btn-login').hide();
    win = window.open(AUTH_URL,
                "_blank",
                "location=1,status=0,scrollbars=0, width=1080,height=800");
    try {
      win.moveTo(500, 300);
    } catch (e) {
    }
    if (e.target.dataset && e.target.dataset['usecase']) {
      targetUsecase = e.target.dataset['usecase'];
    } else {
      targetUsecase = null;
    }
    window.addEventListener('message', function(event) {
      clearInterval(pollInterval);
    });
    pollInterval = setInterval(function (e) {
      win.postMessage('Polling for results', 
                      AUTH_URL)
      }, 2000);
  }

  var launchButtonAction = function(button) {
    button.click(function (e) {
      //this.hide();
      //$('.btn-launch').hide();  
      var id_token = localStorage.getItem('id_token');
      if (! id_token) {
        return $('.btn-login').trigger(e);  
      }
      if (e.target.dataset && e.target.dataset['usecase']) {
        // hide panel
        $( this ).closest('.panel').fadeOut('slow');
        // TODO: Be smarter about refreshes - don't need net calls, but can count divs
        // TODO: Rebalance columns
        //$("#modalLaunchInstance").modal();
        return launchInstance(e.target.dataset['usecase'], 5000);
      }
    });
  }

  var shutdownInstance = function(sandboxHashKey, sandboxDiv) {
    ga('send', 'event', 'sandbox', 'shutdown', sandboxHashKey);
    var id_token = localStorage.getItem('id_token');
    $.ajax
    ({
      type: "POST",
      url: `${API_PATH}/SandboxStopInstance`,
      dataType: 'json',
      data: JSON.stringify({ "sandboxHashKey": sandboxHashKey}),
      contentType: "application/json",
      async: true,
      headers: {
        "Authorization": id_token
      },
      success: function (data){
        sandboxDiv.remove();
        // TODO check number of sandbox divs and update UI based upon it
        updateUx();
      }
    });
  }

  var extendSandbox = function(formValuesObj) {
    ga('send', 'event', 'sandbox', 'extend');
    var id_token = localStorage.getItem('id_token');
    $("#extend-button").prop( "disabled", true);
    $.ajax
    ({
      type: "POST",
      url: `${API_PATH}/SandboxExtend`,
      dataType: 'json',
      data: JSON.stringify(formValuesObj),
      contentType: "application/json",
      async: true,
      headers: {
        "Authorization": id_token
      },
      success: function (data){
        updateUx();
        $('#modalExtendSandbox').modal('hide');
        $("#extend-button").prop( "disabled", false);
        ga('send', 'event', 'sandbox', 'extend-success');
      },
      error: function (jqXHR, textStatus, errorThrown) {
        // TODO display aleraprop( "disabled", true );t
        $("#extend-button").prop( "disabled", false);
        ga('send', 'event', 'sandbox', 'extend-error');
        alert("error extending sandbox. retry");
      }
    });
  }

  var backupInstance = function(sandboxHashKey, sandboxDiv) {
    ga('send', 'event', 'sandbox', 'backup', sandboxHashKey);
    var id_token = localStorage.getItem('id_token');

    $.ajax
    ({
      type: "POST",
      url: `${API_PATH}/SandboxBackupInstance`,
      dataType: 'json',
      data: JSON.stringify({ "sandboxHashKey": sandboxHashKey}),
      contentType: "application/json",
      async: true,
      headers: {
        "Authorization": id_token
      },
      success: function (data){
        sandboxDiv.find('.panel-body-alerts')
          .append($("<div/>")
            .attr("class","alert alert-warning")
            .text("Backup feature not fully implemented. Email devrel@neo4j.com if you have questions or feedback."));
        ga('send', 'event', 'sandbox', 'backup-success', sandboxHashKey);

        //sandboxDiv.remove();
        // TODO check number of sandbox divs and update UI based upon it
        // updateUx();
      },
      error: function (jqXHR, textStatus, errorThrown) {
        sandboxDiv.find('.panel-body-alerts')
          .append($("<div/>")
            .attr("class","alert alert-warning")
            .text("Backup feature not fully implemented (f). Email devrel@neo4j.com if you have questions or feedback."));
        ga('send', 'event', 'sandbox', 'backup-error', sandboxHashKey);
      }
    });
  }

  var updateUx = function() {
    activeInstancesUpdated = false;
    activeUsecases = [];
    retrieve_update_instances(true);
    conditional_update_usecases();
  }

  var launchInstance = function(usecase, errorTimeout ) {
    ga('send', 'event', 'sandbox', 'launching', usecase);
    var id_token = localStorage.getItem('id_token');
    var instance = {}
    instance['status'] = 'PENDING';
    instance['usecase'] = usecase;
    instance['sandboxHashKey'] = usecase + '-**launching**';

    update_instances(instance, usecases);
    $.ajax
    ({
      type: "POST",
      url: `${API_PATH}/SandboxRunInstance`,
      dataType: 'json',
      data: JSON.stringify({ "usecase": usecase}),
      contentType: "application/json",
      async: true,
      headers: {
        "Authorization": id_token 
      },
      success: function (data){
        update_instances(data, usecases);
        $("#alertContainer").empty();
        setTimeout(function() { updateUx() }, 2000);
        ga('send', 'event', 'sandbox', 'launch-success', usecase);
      },
      error: function (jqXHR, textStatus, errorThrown) {
        var json = JSON.parse(jqXHR.responseText);
        console.log("Error starting instance for usecase: " + usecase);
        console.log(json);
        if ('status' in json && json["status"] == "FAILED") {
          errorIsEcsFault = false;
          for (failureIn in json["ECS response"]["failures"]) {
            failure = json["ECS response"]["failures"][failureIn];
            if (failure["reason"].startsWith("RESOURCE") || failure["reason"].startsWith("AGENT")) {
              errorIsEcsFault = true;
            }
          }
          if (errorIsEcsFault) {
            ga('send', 'event', 'sandbox', 'launching-error', 'ECS failure');
            $("#alertContainer").empty().append(
              $("<div/>").attr("class", "alert alert-info").text("Neo4j Sandbox is popular right now, so there's a slight delay in launching your sandbox.  Keep this window open and we'll keep trying.  E-mail us at devrel@neo4j.com if the problem persists.")
            );
            $("#alertContainer").show();
            window.setTimeout( 
              function () { launchInstance(usecase, errorTimeout * 2) }
              ,errorTimeout);
          } else {
            ga('send', 'event', 'sandbox', 'launching-error', 'NON-ECS failure');
          }
        } else {
          ga('send', 'event', 'sandbox', 'launching-error', "Status Unknown");
        }
      }
    });
  }

  var emailVerificationCheck = function( calledFromUpdateProfile ) {
    var profile = localStorage.getItem('profile');
    if (profile) {
      profileObj = JSON.parse(profile);
      if ('email_verified' in profileObj && profileObj['email_verified'] == true) {
        emailVerified = true
      } else if (! ('email_verified' in profileObj)) {
        emailVerificationNotNeeded = true;
      }
      if (emailVerified || emailVerificationNotNeeded) {
        $('.need-verification').hide();
        retrieve_usecases();
        retrieve_update_instances(true);
        conditional_update_usecases();
      } else {
        ga('send', 'event', 'auth', 'email verification needed');
        if (calledFromUpdateProfile) {
          window.setTimeout(
            function () {
              updateProfile()
            }, 10000);
        } else {
          updateProfile();
        }
        $('#sandboxListContainer').hide();
        $('#usecaseListContainer').hide();
        $('.need-verification').show();
      }
    }
  }

  
  var updateProfile = function() {
    var access_token = localStorage.getItem('access_token');
    $.ajax
    ({
      type: "GET",
      url: AUTH_USERINFO_URL,
      dataType: 'json',
      async: true,
      headers: {
        "Authorization": "Bearer " + access_token
      },
      success: function (data){
       localStorage.setItem('profile', JSON.stringify(data));
       emailVerificationCheck(true);
      }
    });
  }

  var checkIfInstanceActive = function(sandboxHashKey) {
      var id_token = localStorage.getItem('id_token');
      $.ajax
      ({
        type: "GET",
        url: `${API_PATH}/SandboxGetInstanceByHashKey`,
        data: {"sandboxHashKey": sandboxHashKey, "verifyConnect": "true"},
        dataType: 'text',
        async: true,
        headers: {
          "Authorization": id_token,
          "Cache-Control": "max-age=0" 
        },
        success: function (data){
          activeInstances.push(sandboxHashKey);
        },
        error: function (jqXHR, textStatus, errorThrown) {
          console.log(errorThrown);
        }
      });
  }
  
  var attemptRenewToken = function(silent, nextTimeout, nextTimeoutSilent) {
    var access_token = localStorage.getItem('access_token');
    var iframe = $('<iframe>')
     .attr("id", "browser-iframe")
     .attr("width", "0") 
     .attr("height", "0") 
     .attr("frameborder", "0");

    refreshingAuth = true;
    iframe.on('load', function() {
      win = document.getElementById("browser-iframe").contentWindow;
      win.postMessage("hellow", "*"); 
    });
    
    // iframe.attr("src", AUTH_AUTHORIZE_URL + "?response_type=token&client_id=" + AUTH_CLIENT_ID  ) 
    iframe.attr("src", AUTH_URL_ORIGIN + "/sandbox-noprompt.html");
    $('body').append(iframe);
  
    if (nextTimeout) {
        setTimeout(
          function () {
            attemptRenewToken(nextTimeoutSilent, nextTimeout, nextTimeoutSilent);
          }, nextTimeout
        ); 
    }
    // TODO: If fails to get a token, should logout
  }

  var retrieve_update_instances = function(retry) {
    var id_token = localStorage.getItem('id_token');
    if (id_token) {
        $('.btn-login').hide();
        $('.btn-logout').show();
        $('#welcome').show();
        /*
        $('#logs').show();
        var editor = CodeMirror.fromTextArea(document.getElementById('logs'), {
          mode: 'shell',
          lineNumbers: true
        })$a
        */;
        $.ajax
        ({
          type: "GET",
          url: `${API_PATH}/SandboxGetRunningInstancesForUser`,
          dataType: 'json',
          async: true,
          headers: {
            "Authorization": id_token,
            "Cache-Control": "max-age=0" 
          },
          success: function (data){
            runningInstances = data;
            if (usecases) {
              update_instances(data, usecases);
            } else {
              window.setTimeout( 
                function () { check_for_instances_and_usecases(200) }
                ,200);
            }
          },
          error: function (jqXHR, textStatus, errorThrown) {
            /* CORS headers unavailable from AWS API Gateway
               when throwing 401, so status details missing. 
               Assume errors are auth failures. */
              // Refresh token
            if (retry) {
              $.ajax
              ({
                type: "POST",
                url: AUTH_DELEGATION_URL,
                contentType: "application/json",
                dataType: 'json',
                async: true,
                data: JSON.stringify(
                  { "client_id": AUTH_CLIENT_ID,
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "refresh_token": localStorage.getItem('refresh_token'),
                    "api_type": "app" }),
                success: function (data){
                  localStorage.setItem('id_token', data.id_token);
                  retrieve_update_instances(false);
                }
              });
            }
          }
        });
        //retrieve_logs(editor, null);
        //$('.btn-launch').show();
    }
  }

  var check_for_instances_and_usecases = function(time) {
    if (runningInstances && usecases) {
      update_instances(runningInstances, usecases);
    } else {
      console.log('Timeout setting for: ' + (time * 2));
      window.setTimeout( 
              function () { check_for_instances_and_usecases(time*2) }
              ,time * 2);
    }
  }

  var retrieve_usecases = function() {
    ajaxOptions = {
      type: "GET",
      url: `${API_PATH}/SandboxGetUsecases`,
      dataType: 'json',
      async: true,
      headers: {
      },
      success: function (data){
        usecases = data;
      }
    }
    additionalUc = localStorage.getItem("sandbox.additionalUc");
    if (additionalUc) {
      try {
        ajaxOptions.data = {"additionalUc": additionalUc};
      } catch (e) {
        console.log(e);
      }
    }
    $.ajax
    (
      ajaxOptions
    );
  }

  var retrieve_show_code_snippets = function(usecase, username, password, ip, httpPort, boltPort, tabjq) {
    tabjq.attr('style', 'min-height: 400px');
    var languages = ['php', 'py', 'java', 'js'];
    var tabs = tabjq.tabs({heightStyle: "content"}).css({'min-height':'300px'});
    for (var langId in languages) {
      language = languages[langId];
      (function(language, usecase, username, password, ip, httpPort, boltPort, tabjq) {
        $.ajax
        ({
          type: "GET",
          url: `${CODE_SNIPPETS_PATH}/${usecase}.${language}.txt`,
          dataType: 'text',
          async: true,
          headers: {
          },
          success: function (data) {
              var ul = tabs.find( "ul" );
              tabs.on( "tabsactivate", codeTabActivate(usecase, language) );
              var code = data.replace("<USERNAME>", username)
                .replace("<PASSWORD>", password)
                .replace("<HOST>", ip)
                .replace("<HTTPPORT>", httpPort)
                .replace("<BOLTPORT>", boltPort)
              $( `<li><a href="#tab-code-${language}">${language}</a></li>` ).appendTo( ul );
              var div = $( `<div id="tab-code-${language}"/ >`);
              var textarea = $('<textarea/>')
              .attr('class', 'code-textarea')
              .attr('style', 'min-height: 200px; max-height: 300px; width: 100%;')
              .text(code)
              .appendTo(div);
              div.appendTo( tabs );
              var mode = 'clike';
              if (language == 'py') {
                mode = 'text/x-python';
              } else if (language == 'java') {
                mode = 'text/x-java';
              } else if (language == 'js') {
                mode = 'text/javascript';
              } else if (language == 'php') {
                mode = 'application/x-httpd-php';
              }
              editors[usecase + '-' + language] = CodeMirror.fromTextArea(textarea.get()[0], {mode: mode, autoRefresh: true, theme: "paraiso-dark"})
              if (tabs.data("ui-tabs")) {
                tabs.tabs('option', 'active', 0); 
                tabs.tabs("refresh"); 
              }

          }
        });
      })(language, usecase, username, password, ip, httpPort, boltPort, tabjq);
    }
  }

  var codeTabActivate = function(usecase, language) {
    return function(event, ui) {
      editors[usecase + '-' + language].refresh();
      //$( "#tabs" ).tabs( "refresh" );
      //$( "#accordion" ).accordion( "refresh" );
    }
  }

  var retrieve_logs = function(editor, sbid, nextToken) {
    ga('send', 'event', 'sandbox', 'retrieving_logs');
    var id_token = localStorage.getItem('id_token');
    if (id_token) {
      data = {"sbid": sbid}
      if (nextToken) {
        data['nextToken'] = nextToken
      }
      $.ajax
      ({
        type: "GET",
        url: `${API_PATH}/SandboxRetrieveUserLogs`,
        data: data,
        dataType: 'json',
        async: true,
        headers: {
          "Authorization": id_token
        },
        success: function (data){
          display_logs(data, editor);
        }
      });
    } else {
      return False;
    }
  }

  var display_logs = function(data, editor) {
    for (var eventid in data.events) {
      editor.replaceRange(data.events[eventid].message + "\n", CodeMirror.Pos(editor.lastLine()));
    }
/*    if (data.nextForwardToken) {
      setTimeout(retrieve_logs, 10000, editor, data.nextForwardToken);
    }*/
  } 


  var conditional_update_usecases = function() {
    if (usecases && activeInstancesUpdated) {
      update_usecases(usecases);
    } else {
      setTimeout(function() { conditional_update_usecases() }, 100); 
    }
  }

  var update_usecases = function(usecases) {
    var profile = localStorage.getItem('profile');
    var profileObj = JSON.parse(profile);
    var sub = profileObj['sub']
    var authProvider = sub.substr(0, sub.indexOf('|'));

    availableForLaunchCount = 0;
    $('#usecaseList').find('.col-md-6').empty();
    for (var usecaseNum in usecases) {
      usecase = usecases[usecaseNum]
      ucname = usecase.name

      /* always show blank sandbox for testing TODO remove */
      if (! (ucname in activeUsecases)) {
        columnNum = (availableForLaunchCount % 2 ) + 1;
        panelDiv = $('<div/>').attr('class', 'panel panel-primary')
          .append(
            $('<div/>').attr('class', 'panel-heading').text(usecase.long_name)
          )
          .append(
            $('<div/>').attr('class', 'panel-body').attr('style', 'height: 130px')
              .append($('<img/>')
                .attr('src', usecase.logo)
                .attr('height', '100')
                .attr('width', '100')
                .attr('style', 'float: left; margin-right: 15px; margin-bottom: 15px;'))
              .append(
                $('<p/>').attr('style', 'font-size: 0.8rem; line-height: 1.3').text(usecase.description))
              .append(
                $('<div/>').attr('style', 'padding-top: 10px; margin-bottom: 5px;').append(
                  $('<button/>').attr('type','button').attr('class','btn btn-sm btn-success btn-launch')
                  .attr('data-usecase', ucname)
                  .text('Launch Sandbox')
                )
              )
          );
        if (ucname == 'twitter' && authProvider != 'twitter') {
          panelDiv.fadeTo(400, 0.6);
          panelDiv.attr('style', '-webkit-filter: grayscale(1);');
          panelDiv.find('.btn-launch').prop('disabled', true);
          $('.uc-col-' + columnNum).append(panelDiv) 
          availableForLaunchCount++;
        } else {
          $('.uc-col-' + columnNum).append(panelDiv) 
          launchButtonAction(panelDiv.find('.btn-launch'));
          availableForLaunchCount++;
        }
      }
    }
    $("#usecaseListContainer").show();
    if (availableForLaunchCount > 0) {
      $('#usecaseListAlert').hide();
      $('#usecaseList').show();
    } else {
      $('#usecaseList').hide();
      $('#usecaseListAlert').show();
    }
  }

  var update_instances = function(instances, usecases) {
    sandboxListDiv = $("#sandboxList");

    // this is a new launch
    if (! Array.isArray(instances) ){
      instances = [ instances ];
    }

    var shouldUpdateInstances = false;


    for (var instanceNum in instances) {
      var instance = instances[instanceNum];
      var thisUsecase = false;
      instance.username = 'neo4j';

      activeUsecases[instance.usecase] = true;

      for (var ucNum in usecases) {
        if (usecases[ucNum].name == instance.usecase) {
          thisUsecase = usecases[ucNum]
        }
      }

      templateSandbox = null;
      existingSandbox = sandboxListDiv.find(`[data-sandboxhashkey='${instance.sandboxHashKey}']`);
      if (existingSandbox.length == 0) {
        templateSandbox = sandboxListDiv.find("[data-sandboxhashkey='" + instance.usecase + "-**launching**']");
      }

      if ('status' in instance && instance['status'] == 'PENDING') {
        if (templateSandbox && templateSandbox.length > 0) {
          sandboxDiv = templateSandbox;
        } else {
          sandboxDiv = $("#sandbox_launching_template").clone();
        }
      } else if ((instance['connectionVerified'] != true) && $.inArray(instance.sandboxHashKey,activeInstances) == -1) {
        sandboxDiv = $("#sandbox_launching_template").clone();
      } else {
        sandboxDiv = $("#sandbox_template").clone();
      }
      sandboxDiv
      .removeAttr('id')
      .removeAttr('data-sandboxid')
      .removeAttr('data-sandboxhashkey')
      .attr('data-sandboxid', instance.sandboxId)
      .attr('data-sandboxhashkey', instance.sandboxHashKey);
     
      if (thisUsecase && 'long_name' in thisUsecase) {
        sandboxDiv.find('.navbar-brand').text(thisUsecase.long_name);
      }

      sandboxDiv.find('.connection a').click(update_sandbox_panel('connection', instance.sandboxId));
      var connectionDiv = sandboxDiv.find('.panel-body-content').find('.connection');
      connectionDiv.empty();

      dateDiff = getTimeDiff(Date.now(), instance.expires);
      if (dateDiff['days'] == 1) {
        daysStr = 'day';
      } else {
        daysStr = 'days';
      }
      if (dateDiff['minutes'] == 1) {
        minsStr = 'minute';
      } else {
        minsStr = 'minutes';
      }
      if (dateDiff['hours'] == 1) {
        hoursStr = 'minute';
      } else {
        hoursStr = 'hours';
      }
      expiresString = `${dateDiff['days']} ${daysStr}, ${dateDiff['hours']} ${hoursStr}, ${dateDiff['mins']} ${minsStr}`
      triggerExpiresWarning = false;
      expiresWarningLevel = '';
      if (dateDiff['days'] < 2) {
        triggerExpiresWarning = true;
        if (dateDiff['days'] < 1) {
          expiresWarningLevel = 'danger';
        } else {
          expiresWarningLevel = 'warning';
        }
        sandboxDiv.find('.panel-body-alerts').append($('<div/>').attr('class', `alert alert-custom alert-${expiresWarningLevel}`).html(`<strong>Warning:</strong> Sandbox expires in ${expiresString}. <button type="button" class="btn btn-primary btn-sm" data-toggle="modal" data-target="#modalExtendSandbox">Extend Sandbox</button>`));
        //$(".extend-sandbox").on("click", function() { $("#extend-sandbox-dialog").dialog("open") });
      }

      if ('status' in instance && instance['status'] == 'PENDING') {
        if (templateSandbox && templateSandbox.length >= 1) {
          newLaunch = false;
        } else {
          newLaunch = true;
        }
        connectionDiv.append($('<p/>').text('Did you know you can fit 520,769,230,760 grains of sand into a freight container?').attr("style", "font-family: 'Lora', serif; font-size: 200%; text-shadow: 2px 2px 1px rgba(0,0,0, 0.25);"));
        connectionDiv.append($('<p/>').text(''));
        connectionDiv.append($('<p/>').text('Launching! Will show connection info when available.'));
        shouldUpdateInstances = true;
      } else if (instance.ip == null) {
        newLaunch = false;
        connectionDiv.append($('<p/>').text('Did you know you can fit 520,769,230,760 grains of sand into a freight container?').attr("style", "font-family: 'Lora', serif; font-size: 200%; text-shadow: 2px 2px 1px  rgba(0,0,0, 0.25);"));
        connectionDiv.append($('<p/>').text(''));
        connectionDiv.append($('<p/>').text('Launching! Will show connection info when available.'));
        shouldUpdateInstances = true;
      } else if ((instance['connectionVerified'] != true) && $.inArray(instance.sandboxHashKey,activeInstances) == -1){
        newLaunch = false;
        connectionDiv.append($('<p/>').html('Did you know the first paper on graph theory was published in 1736 by Leonhard Euler?  It is titled <i>Seven Bridges of Königsberg</i>.').attr("style", "font-family: 'Lora', serif; font-size: 200%; text-shadow: 2px 2px 1px rgba(0,0,0, 0.25);"));
        connectionDiv.append($('<p/>').text(''));
        connectionDiv.append($('<p/>').text('Connecting to sandbox.'));
        checkIfInstanceActive(instance.sandboxHashKey);
        shouldUpdateInstances = true;
      } else {
        newLaunch = false;
        connectionDiv.append(
              $('<img/>')
                .attr('src', thisUsecase['logo'])
                .attr('height', '175')
                .attr('width', '175')
                .attr('style', 'float: left; margin-right: 15px;')
        );
        browserUrl = "https://" + instance.privip.replace(/\./g, "-") + "-" + instance.port + ".neo4jsandbox.com/";
        directBrowserUrl = "http://" + instance.ip + ":" + instance.port + "/browser/";
        sandboxDiv.find('.get-started a').click(update_sandbox_panel('get-started', instance.sandboxId));
        var getStartedDiv = sandboxDiv.find('.panel-body-content').find('.get-started');
        getStartedDiv.empty();
  
        var rowDiv = $('<div>').attr('class', 'row');
        rowDiv.append(
          $('<div>').attr('class', 'col-sm-3 hidden-xs')
            .append(
              $('<img/>')
               .attr('src', thisUsecase['logo'])
               .attr('height', '175')
               .attr('width', '175')
               .attr('style', 'float: left; margin-right: 15px;')
              )
        );
        rowDiv.append(
          $('<div>').attr('class', 'col-sm-9 col-xs-12')
            .append(
              $('<div>').attr('class', 'row')
              .append(
                $('<div>').attr('class', 'col-md-12')
                .append(
                  $('<h4>').text('Get Started with your Neo4j Sandbox')
                )
              )
            )
            .append(
              $('<div>').attr('class', 'row')
              .append(
                $('<div>').attr('class', 'col-xs-1 col-bullet')
                .append(
                  $('<div>').attr('class', 'image-bullet')
                    .append( $('<img>').attr('src', '//dev.neo4jsandbox.com/img/image-bullet.svg') )
                    .append( $('<div>').attr('class', 'image-bullet-text').text('1') )
                )
              )
              .append(
                $('<div>').attr('class', 'col-xs-11 col-bullet-para')
                .append(
                  $('<p>').html(`Visit the <a href="${browserUrl}" onclick="window.open('${browserUrl}' + '#' + browserIdToken); return false;" target="_blank">Neo4j Browser</a>. Login with the credentials found under the "Details" tab above. A tutorial will guide you through the datamodel and example data, while teaching you how property graphs work in real-world use cases.`)
                )
              )
            )
            .append(
              $('<div>').attr('class', 'row')
              .append(
                $('<div>').attr('class', 'col-xs-1 col-bullet')
                .append(
                  $('<div>').attr('class', 'image-bullet')
                    .append( $('<img>').attr('src', '//dev.neo4jsandbox.com/img/image-bullet.svg') )
                    .append( $('<div>').attr('class', 'image-bullet-text').text('2') )
                )
              )
              .append(
                $('<div>').attr('class', 'col-xs-11 col-bullet-para')
                .append(
                  $('<p>').html(`Start building your application backed by Neo4j. Write your own code, in PHP, Java, JavaScript, Python, or one of any number of other languages, using <a id="code-templates-link" href="">templates provided</a>.`)
                )
              )
            )
            .append(
              $('<div>').attr('class', 'row')
              .append(
                $('<div>').attr('class', 'col-xs-1 col-bullet')
                .append(
                  $('<div>').attr('class', 'image-bullet')
                    .append( $('<img>').attr('src', '//dev.neo4jsandbox.com/img/image-bullet.svg') )
                    .append( $('<div>').attr('class', 'image-bullet-text').text('3') )
                )
              )
              .append(
                $('<div>').attr('class', 'col-xs-11 col-bullet-para')
                .append(
                  $('<p>').html(`<a href="//neo4j.com/download/" target="_blank">Download Neo4j</a> to your own computer, or start a long-living Neo4j instance in the cloud on <a href="//neo4j.com/developer/guide-cloud-deployment/" target="_blank">AWS or other hosting platforms</a>.`)
                )
              )
            )
        );
        getStartedDiv.append(rowDiv);
        connectionDiv.append(
            $('<p/>')
              .append(
                $('<b/>').text('Neo4j Browser: '))
              .append(
                $('<b/>')
                .append($('<a/>')
                  .attr('href', `${browserUrl}`)
                  .attr('onclick', `window.open('${browserUrl}' + '#' + browserIdToken); return false;`)
                  .attr('target', '_blank')
                  .text(`${browserUrl}`)
              )))
            .append($('<p/>')
              .append(
                $('<b/>').text('Direct Neo4j HTTP: '))
              .append(
                $('<b/>')
                .append($('<a/>')
                  .attr('href', `${directBrowserUrl}`)
                  .attr('target', '_blank')
                  .text(`${directBrowserUrl}`)
              )))
            .append($('<p/>')
              .html(`<b>Username:</b> ${instance.username}<br />` +
                    //`<b>Password:</b> <input type="text" size="${instance.password.length}" id="pw-${instance.sandboxHashKey}" value="${instance.password}" style="border: 0px"></input>` +
                    `<b>Password:</b> <span id="pw-${instance.sandboxHashKey}" style="margin-right: 10px">${instance.password}</span>` +
                    `<button type="button" class="btn copybtn btn-default btn-xs" data-clipboard-target="#pw-${instance.sandboxHashKey}">` + 
                    `<span class="glyphicon glyphicon-copy" aria-hidden="true"></span></button>` +
                    `` ))
            .append($('<p/>')
              .html(`<b>IP Address:</b> ${instance.ip}<br />` +
                    `<b>HTTP Port:</b> ${instance.port}<br />` +
                    `<b>Bolt Port:</b> ${instance.boltPort}`))
            .append($('<p/>')
              .html(`<b>Expires:</b> ${expiresString}`));
      }

      sandboxDiv.find('.datamodel a').click(update_sandbox_panel('datamodel', instance.sandboxId));
      var datamodelDiv = sandboxDiv.find('.panel-body-content').find('.datamodel');
      datamodelDiv.empty().append($('<img/>')
                          .attr('src', instance.modelImage)
                          .attr('width', '100%'));


      sandboxDiv.find('#code-templates-link').click(
        show_code_panel(sandboxDiv)
      );
      sandboxDiv.find('.code a').click(update_sandbox_panel('code', instance.sandboxId));
      var codeDiv = sandboxDiv.find('.panel-body-content').find('.code');
      codeDiv.empty().append($('<div/>')
                          .attr('class', `tabs-code-${instance.usecase} tabs-nohdr`)
                          .append($('<ul />')))
                        .tabs({heightStyle: "content"});// .tabs("refresh");
      
      retrieve_show_code_snippets(instance.usecase, instance.username, instance.password, instance.ip, instance.port, instance.boltPort, codeDiv.find(`.tabs-code-${instance.usecase}`));


      shutdownInstanceAction(sandboxDiv, instance, sandboxDiv.find('.shutdown a') );
      backupInstanceAction(sandboxDiv, instance, sandboxDiv.find('.backup a') );
      sandboxDiv.hide();
      if (templateSandbox && templateSandbox.length > 0){
        templateSandbox.replaceWith(sandboxDiv);
      } else if (existingSandbox.length == 0) {
        sandboxListDiv.append(sandboxDiv);
      } else {
        // sandbox already here, update as necessary
        existingSandbox.replaceWith(sandboxDiv);
      }
      if (newLaunch) {
        sandboxDiv.fadeIn(2000);
      } else {
        sandboxDiv.show();
      }
    }

    if (instances.length > 0) {
      $("#sandboxListContainer").show();
    }

    if (shouldUpdateInstances) {
        setTimeout(function() { retrieve_update_instances(true) }, 2000);
    }

    activeInstancesUpdated = true;
  }

  var update_sandbox_panel = function(panelName, sandboxId) {
    return function (event) {
        if (panelName == 'code') {
	   setTimeout( function() {
              for (var key in editors) {
                  (editors[key]).refresh()
              }
           }, 500);
        } 
        if (! event.target.parentElement.classList.contains('active')) {
            // this element isn't active, set it active and update content
            $( event.target.parentElement.parentElement ).find('li').removeClass('active');
            $( event.target.parentElement ).addClass('active');
            $( event.target ).closest('.panel').find('.panel-body-content').children().hide();
            $( event.target ).closest('.panel').find('.panel-body-content').find('.' + panelName).show();
           console.log('Selected ' + panelName + ' for sandbox id: ' + sandboxId);
        }
        event.preventDefault();
        //bar
    }
  }
  var show_code_panel = function(sandboxDiv) {
     return  function(e) {
      sandboxDiv.find('.code a').click()
      e.preventDefault()
    }
  }

  var show_instances = function(instances) {
    for (var instanceNum in instances) {
        var e = jQuery.Event('runningInstance');
        e.usecase = instances[instanceNum].usecase;
        if(instances[instanceNum].ip) {
          window.dispatchEvent(new CustomEvent('runningInstance', {detail: { usecase: instances[instanceNum].usecase, modelImage: instances[instanceNum].modelImage, sandboxId: instances[instanceNum].sandboxId, ip: instances[instanceNum].ip, boltPort: instances[instanceNum].boltPort, port: instances[instanceNum].port, username: 'neo4j', password: instances[instanceNum].password, taskId: instances[instanceNum].taskid }}));
        } else {
          window.dispatchEvent(new CustomEvent('startingInstance', {detail: { usecase: instances[instanceNum].usecase, sandboxId: instances[instanceNum].sandboxId } }));
          //setTimeout(retrieve_show_instances, 5000);
        }
    }
  }

  var logout = function() {
    ga('send', 'event', 'auth', 'logout');
    localStorage.removeItem('id_token');
    localStorage.removeItem('profile');
    localStorage.removeItem('access_token');
    $('.btn-logout').hide();
    $('.btn-login').show();
    $('.marketing').show();
    $('.jumbotron').show();
    $('#sandboxList').empty();
    $('#sandboxListContainer').hide();
    $('#usecaseListContainer').hide();
    $('#identityContainer').hide();
  };

$(document).ready(function() {
  // load codemirror late, after neo4j.com codemirror
  $.getScript("//neo4jsandbox.com/cm/mode/javascript/javascript.js");
  $.getScript("//neo4jsandbox.com/cm/mode/python/python.js");
  $.getScript("//neo4jsandbox.com/cm/mode/php/php.js");
  $.getScript("//neo4jsandbox.com/js/cm-autorefresh.js");

  $('.carousel-inner .item .carousel-caption')
    .attr("style", "background-color: rgba(0, 0, 0, 0.4); padding: 5px 5px 5px 5px");

  $('#carousel-sandbox-features').carousel(
  {
    interval: 10000
  }
  );

  $('.btn-login').click(function (e) {
    loginButtonAction(e);
  });
  $('.btn-startnow').click(function (e) {
    loginButtonAction(e);
  });
  $('.btn-logout').click(function(e) {
    e.preventDefault();
    logout();
  })

  /* Clipboard for copying passwords */
  new Clipboard('.copybtn');

  /* Check to see if user is already logged in */
  var profile = localStorage.getItem('profile');
  if (profile && profile != 'undefined') {
    ga('send', 'event', 'auth', 'loaded from localstorage');
    profileObj = JSON.parse(profile);
    updateIdentity();


    if (localStorage.getItem('id_token')) {
      ga('send', 'event', 'auth', 'have id_token');

      // check if token is expired;
      var token = localStorage.getItem('id_token');
      var expiresIn = getTimeDiff(Date.now(), (jwt_decode(token).exp) * 1000);
      if (expiresIn.days < 0 || expiresIn.hours < 0 || expiresIn.mins < 0) {
        // token is already expired, log user out 
        logout();
      } else if (expiresIn.days == 0 && expiresIn.hours == 0 || expiresIn.mins < 30) {
        // expiring soon, let's immediately get a new token
        attemptRenewToken(true, authRenewPeriod, false);
        getBrowserToken(true, authRenewPeriod)

        setTimeout(
          function () {
            attemptRenewToken(false, authRenewPeriod, false)
            getBrowserToken(true, authRenewPeriod)
          }, 
          authRenewPeriod
        );

        // still signed in so no need to wait for this
        $('.jumbotron').fadeOut("fast");
        $('.marketing').fadeOut("fast");
        $('.btn-login').hide();
        $('.btn-logout').show();
        emailVerificationCheck(false);
      } else {
        getBrowserToken(true, authRenewPeriod)
        setTimeout(
          function () {
            attemptRenewToken(false, authRenewPeriod, false)
            getBrowserToken(true, authRenewPeriod)
          }, 
          authRenewPeriod
        );
        // still signed in so no need to wait for this
        $('.jumbotron').fadeOut("fast");
        $('.marketing').fadeOut("fast");
        $('.btn-login').hide();
        $('.btn-logout').show();
        emailVerificationCheck(false);
      }

      shaObj.update(profileObj['sub']);
      hash = shaObj.getHash("HEX");
      ga('set', 'userId', hash);
    }
  }

  /* Extend sandboxes form and processing */
  var form = ($('#extend-sandboxes'))[0];
  var validator = new window.Validator(form, {
    namespace: 'sb',
    trigger: 'input',
    stopOnError: false,
    success: function(e) {
      var input = e.target;
      input.classList.remove('form-control-warning');
      input.classList.add('form-control-success');
      input.parentNode.classList.remove('has-warning');
      input.parentNode.classList.add('has-success');
      input.nextElementSibling.classList.remove('glyphicon-remove');
      input.nextElementSibling.classList.add('glyphicon-ok');
    },
    error: function(e) {
      var input = e.target;
      input.focus();
      input.classList.remove('form-control-success');
      input.classList.add('form-control-warning');
      input.parentNode.classList.remove('has-success');
      input.parentNode.classList.add('has-warning');
      input.nextElementSibling.classList.remove('glyphicon-ok');
      input.nextElementSibling.classList.add('glyphicon-remove');
    }
  });
  $("#extend-button").click(
    function(e) {
      var validForm = true;
      allInput = $("#extend-sandboxes").find(':input').toArray();
      for (i in allInput) {
        if (validator.isInvalid(allInput[i])) {
          validForm = false;
        }
      }
      if (validForm) {
        var formValuesObj = serializeForm($("#extend-sandboxes"));
        extendSandbox(formValuesObj);
      } else {
        e.preventDefault();
      }
      return false;
    }
  );
});
