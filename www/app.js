  const API_PATH = "https://ppriuj7e7i.execute-api.us-east-1.amazonaws.com/prod"
  const AUTH_URL = "https://auth.neo4j.com/index.html"

  var pollInterval;

  var listener = function(event) {
    $('.btn-login').hide();
    $('.btn-launch').show();
    //$('#logs').show();
    event.source.close();
    localStorage.setItem('id_token', event.data.token)
    localStorage.setItem('profile', JSON.stringify(event.data.profile))
    show_profile_info(event.data.profile)
    retrieve_show_instances();
  }
 
  if (window.addEventListener){
    addEventListener("message", listener, false)
  } else {
    attachEvent("onmessage", listener)
  }

  var loginButtonAction = function(e) {
    win = window.open(AUTH_URL,
                "loginWindow",
                "location=0,status=0,scrollbars=0, width=1080,height=720");
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
      if (targetUsecase) {
        window.setTimeout(launchInstance(targetUsecase), 1000);
      }
    });
    pollInterval = setInterval(function (e) {
      win.postMessage('Polling for results', 
                      AUTH_URL)
      }, 6000);
  }

  var launchButtonAction = function() {
    $('.btn-launch').click(function (e) {
      this.hide();
      //$('.btn-launch').hide();  
      var id_token = localStorage.getItem('id_token');
      if (! id_token) {
        return $('.btn-login').trigger(e);  
      }
      if (e.target.dataset && e.target.dataset['usecase']) {
        return launchInstance(e.target.dataset['usecase']);
      } else {
        return launchInstance('us-elections-foo');
      }
    });
  }

  var launchInstance = function(usecase) {
    var id_token = localStorage.getItem('id_token');
    var rand = Math.floor((Math.random() * 100) + 1);

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
        retrieve_show_instances();
      }
    });
  }

  var show_profile_info = function(profile) {
     $('.nickname').text(profile.nickname);
     $('.btn-login').hide();
     $('.avatar').attr('src', profile.picture).show();
     $('.btn-logout').show();
     $('#welcome').show();
  };

  var retrieve_show_instances = function() {
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
            "Authorization": id_token 
          },
          success: function (data){
            show_instances(data);
          }
        });
        //retrieve_logs(editor, null);
        //$('.btn-launch').show();
    }
  }

  var retrieve_show_usecases = function() {
    $.ajax
    ({
      type: "GET",
      url: `${API_PATH}/SandboxGetUsecases`,
      dataType: 'json',
      async: true,
      headers: {
      },
      success: function (data){
        show_usecases(data);
      }
    });
  }

  var retrieve_logs = function(editor, sbid, nextToken) {
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

  var show_usecases = function(usecases) {
    var oList = $('#usecaseList')
    var uList = $('<ul>', {id: 'usecaseList'})
    for (var usecaseNum in usecases) {
      (function (ucname) {
        var usecase = usecases[usecaseNum]
        var li = $('<li/>')
          .attr('class', 'usecaseListItem')
          .appendTo(uList);
        var divUsecase = $('<div/>')
          .appendTo(li)
          .attr('id', 'usecase:' + ucname);
        var divUsecaseImage = $('<div/>')
          .attr('class', 'usecase-div-image')
          .appendTo(divUsecase);
        var imgUsecaseImage = $('<img/>')
          .attr('class', 'usecase-img')
          .attr('src', usecase.logo)
          .appendTo(divUsecaseImage);
        var divUsecaseDescription = $('<div/>')
          .attr('class', 'usecase-div-description')
          .appendTo(divUsecase);
        var paraUsecaseDescription = $('<p/>')
          .text(`${usecase.name} - ${usecase.description}`)
          .appendTo(divUsecaseDescription);
        var paraUsecaseLaunchButton = $('<p/>')
          .appendTo(divUsecaseDescription);
        var buttonUsecaseLaunch = $('<button/>')
          .attr('type', 'submit')
          .attr('class', 'btn-launch')
          .attr('data-usecase', usecase.name)
          .text('Launch Sandbox')
          .appendTo(paraUsecaseLaunchButton);
        var divUsecaseConnections = $('<div/>')
          .attr('class', 'connectionsList')
          .appendTo(divUsecaseDescription);
        var divUsecaseClear = $('<div/>')
          .attr('class', 'clear')
          .appendTo(divUsecase);

        window.addEventListener("runningInstance", function (event) {
          var sandboxId = event.detail.sandboxId;
          if (event.detail && event.detail.usecase && event.detail.usecase == ucname) {
              $('*[data-usecase="' + ucname + '"]').hide();
              var currentConnections = 
                divUsecaseConnections.find(`*[data-sandboxid="${event.detail.sandboxId}"]`)
              var divConnectionInfo = $('<div/>')
                  .attr('class', 'connectionInfoItem')
                  .attr('data-connectioninfo', `${event.detail.ip}:${event.detail.port}`)
                  .attr('data-sandboxid', event.detail.sandboxId)
                  .append(
                    $('<div/>')
                      .append($('<ul/>')
                        .append($('<li/>')
                          .append($('<a/>')
                            .attr('href','#tabs-connection-info')
                            .text('Connection Info')))
                        .append($('<li/>')
                          .append($('<a/>')
                            .attr('href','#tabs-datamodel')
                            .text('Data Model')))
                        .append($('<li/>')
                          .append($('<a/>')
                            .attr('href','#tabs-code')
                            .text('Code')))
                        .append($('<li/>')
                          .append($('<a/>')
                            .attr('href','#tabs-logs')
                            .text('Logs'))))
                      .append($('<div/>')
                        .attr('id','tabs-connection-info')
                        .append($('<p/>')
                          .text('Neo4j Browser: ')
                          .append($('<a/>')
                            .attr('href', `http://${event.detail.ip}:${event.detail.port}/`)
                            .text(`http://${event.detail.ip}:${event.detail.port}/`)
                          ))
                        .append($('<p/>')
                          .html(`username: ${event.detail.username}<br />` +
                                `password: ${event.detail.password}`)))
                      .append($('<div/>')
                        .attr('id','tabs-datamodel')
                        .append($('<img/>')
                          .attr('src', event.detail.modelImage)
                          .attr('width', '100%')))
                      .append($('<div/>')
                        .attr('id','tabs-code')
                        .append($('<p/>')
                          .text('Code samples here')))
                      .append($('<div/>')
                        .attr('id','tabs-logs')
                        .append($('<textarea/>')
                          .attr('id', `logs-${event.detail.sandboxId}`)
                          .attr('value',"")
                          .text("loading...\n")
                          ))
                      .tabs({
                        activate: function(event, ui) {
                          if (ui.newTab[0].outerText == "Logs") {
                            if (! ui.newPanel[0].lastChild.CodeMirror) {
                              var editor = CodeMirror.fromTextArea(
                                ui.newPanel[0].firstChild, {
                                mode: 'shell',
                                lineNumbers: true
                              })
                              retrieve_logs(editor, sandboxId, null);
                            }
                          }
                        }
                      }));
                    /*
                    $('<a/>')
                      .attr('href', `http://${event.detail.ip}:${event.detail.port}/`)
                      .text(`http://${event.detail.ip}:${event.detail.port}/`)
                    );*/
              if(currentConnections.length == 0) {
                divConnectionInfo.appendTo(divUsecaseConnections);
              } else {
                currentConnections.replaceWith(divConnectionInfo);
              }
          }    
        });
        window.addEventListener("startingInstance", function (event) {
          if (event.detail && event.detail.usecase && event.detail.usecase == ucname) {
              $('*[data-usecase="' + ucname + '"]').hide();
              var currentConnections = 
                divUsecaseConnections.find(`*[data-sandboxid="${event.detail.sandboxId}"]`)
              if(currentConnections.length == 0) {
                $('<div/>')
                    .attr('data-sandboxid', event.detail.sandboxId)
                    .text("Starting instance for this usecase.  Give me a few seconds please")
                    .appendTo(divUsecaseConnections);
              }
          }    
        });
      })(usecases[usecaseNum].name);
    }
    oList.replaceWith(uList);
    // update buttons
    launchButtonAction();
  }

  var show_instances = function(instances) {
    for (var instanceNum in instances) {
        var e = jQuery.Event('runningInstance');
        e.usecase = instances[instanceNum].usecase;
        if(instances[instanceNum].ip) {
          window.dispatchEvent(new CustomEvent('runningInstance', {detail: { usecase: instances[instanceNum].usecase, modelImage: instances[instanceNum].modelImage, sandboxId: instances[instanceNum].sandboxId, ip: instances[instanceNum].ip, port: instances[instanceNum].port, username: 'neo4j', password: instances[instanceNum].password }}));
        } else {
          window.dispatchEvent(new CustomEvent('startingInstance', {detail: { usecase: instances[instanceNum].usecase, sandboxId: instances[instanceNum].sandboxId } }));
          setTimeout(retrieve_show_instances, 5000);
        }
    }
  }

  var logout = function() {
    localStorage.removeItem('id_token');
    window.location.href = window.location.href;
  };

$(document).ready(function() {
  $('.btn-login').click(function (e) {
    loginButtonAction(e);
  });
  $('.btn-logout').click(function(e) {
    e.preventDefault();
    logout();
  })
  var profile = localStorage.getItem('profile');
  if (profile) {
    try {
      show_profile_info(JSON.parse(profile))    
    } catch (err) {

    }
  }
  retrieve_show_usecases();
  retrieve_show_instances();
});

